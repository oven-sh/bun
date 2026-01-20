#! /usr/bin/env node

// This is a script that runs `bun test` to test Bun itself.
// It is not intended to be used as a test runner for other projects.
//
// - It runs each `bun test` in a separate process, to catch crashes.
// - It cannot use Bun APIs, since it is run using Node.js.
// - It does not import dependencies, so it's faster to start.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  appendFileSync,
  existsSync,
  constants as fs,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlink,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { availableParallelism, userInfo } from "node:os";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as setTimeoutPromise } from "node:timers/promises";
import { parseArgs } from "node:util";
import pLimit from "./p-limit.mjs";
import {
  getAbi,
  getAbiVersion,
  getArch,
  getBranch,
  getBuildLabel,
  getBuildUrl,
  getCommit,
  getDistro,
  getDistroVersion,
  getEnv,
  getFileUrl,
  getHostname,
  getLoggedInUserCountOrDetails,
  getOs,
  getSecret,
  getShell,
  getWindowsExitReason,
  isBuildkite,
  isCI,
  isGithubAction,
  isLinux,
  isMacOS,
  isWindows,
  isX64,
  printEnvironment,
  reportAnnotationToBuildKite,
  startGroup,
  tmpdir,
  unzip,
  uploadArtifact,
} from "./utils.mjs";

let isQuiet = false;
const cwd = import.meta.dirname ? dirname(import.meta.dirname) : process.cwd();
const testsPath = join(cwd, "test");

const spawnTimeout = 5_000;
const spawnBunTimeout = 20_000; // when running with ASAN/LSAN bun can take a bit longer to exit, not a bug.
const testTimeout = 3 * 60_000;
const integrationTimeout = 5 * 60_000;

function getNodeParallelTestTimeout(testPath) {
  if (testPath.includes("test-dns")) return 60_000;
  if (testPath.includes("-docker-")) return 60_000;
  if (!isCI) return 60_000; // everything slower in debug mode
  if (options["step"]?.includes("-asan-")) return 60_000;
  return 20_000;
}

process.on("SIGTRAP", () => {
  console.warn("Test runner received SIGTRAP. Doing nothing.");
});

const { values: options, positionals: filters } = parseArgs({
  allowPositionals: true,
  options: {
    ["node-tests"]: {
      type: "boolean",
      default: false,
    },
    /** Path to bun binary */
    ["exec-path"]: {
      type: "string",
      default: "bun",
    },
    ["step"]: {
      type: "string",
      default: undefined,
    },
    ["build-id"]: {
      type: "string",
      default: undefined,
    },
    ["bail"]: {
      type: "boolean",
      default: false,
    },
    ["shard"]: {
      type: "string",
      default: getEnv("BUILDKITE_PARALLEL_JOB", false) || "0",
    },
    ["max-shards"]: {
      type: "string",
      default: getEnv("BUILDKITE_PARALLEL_JOB_COUNT", false) || "1",
    },
    ["include"]: {
      type: "string",
      multiple: true,
      default: undefined,
    },
    ["exclude"]: {
      type: "string",
      multiple: true,
      default: undefined,
    },
    ["quiet"]: {
      type: "boolean",
      default: false,
    },
    ["smoke"]: {
      type: "string",
      default: undefined,
    },
    ["vendor"]: {
      type: "string",
      default: undefined,
    },
    ["retries"]: {
      type: "string",
      default: isCI ? "3" : "0", // N retries = N+1 attempts
    },
    ["junit"]: {
      type: "boolean",
      default: false, // Disabled for now, because it's too much $
    },
    ["junit-temp-dir"]: {
      type: "string",
      default: "junit-reports",
    },
    ["junit-upload"]: {
      type: "boolean",
      default: isBuildkite,
    },
    ["coredump-upload"]: {
      type: "boolean",
      default: isBuildkite && isLinux,
    },
    ["parallel"]: {
      type: "boolean",
      default: false,
    },
  },
});

const cliOptions = options;

if (cliOptions.junit) {
  try {
    cliOptions["junit-temp-dir"] = mkdtempSync(join(tmpdir(), cliOptions["junit-temp-dir"]));
  } catch (err) {
    cliOptions.junit = false;
    console.error(`Error creating JUnit temp directory: ${err.message}`);
  }
}

if (options["quiet"]) {
  isQuiet = true;
}

/** @type {string[]} */
let allFiles = [];
/** @type {string[]} */
let newFiles = [];
let prFileCount = 0;
if (isBuildkite) {
  try {
    console.log("on buildkite: collecting new files from PR");
    const per_page = 50;
    const { BUILDKITE_PULL_REQUEST } = process.env;
    for (let i = 1; i <= 10; i++) {
      const res = await fetch(
        `https://api.github.com/repos/oven-sh/bun/pulls/${BUILDKITE_PULL_REQUEST}/files?per_page=${per_page}&page=${i}`,
        { headers: { Authorization: `Bearer ${getSecret("GITHUB_TOKEN")}` } },
      );
      const doc = await res.json();
      console.log(`-> page ${i}, found ${doc.length} items`);
      if (doc.length === 0) break;
      for (const { filename, status } of doc) {
        prFileCount += 1;
        allFiles.push(filename);
        if (status !== "added") continue;
        newFiles.push(filename);
      }
      if (doc.length < per_page) break;
    }
    console.log(`- PR ${BUILDKITE_PULL_REQUEST}, ${prFileCount} files, ${newFiles.length} new files`);
  } catch (e) {
    console.error(e);
  }
}

let coresDir;

if (options["coredump-upload"]) {
  // this sysctl is set in bootstrap.sh to /var/bun-cores-$distro-$release-$arch
  const sysctl = await spawnSafe({ command: "sysctl", args: ["-n", "kernel.core_pattern"] });
  coresDir = sysctl.stdout;
  if (sysctl.ok) {
    if (coresDir.startsWith("|")) {
      throw new Error("cores are being piped not saved");
    }
    // change /foo/bar/%e-%p.core to /foo/bar
    coresDir = dirname(sysctl.stdout);
  } else {
    throw new Error(`Failed to check core_pattern: ${sysctl.error}`);
  }
}

let remapPort = undefined;

/**
 * @typedef {Object} TestExpectation
 * @property {string} filename
 * @property {string[]} expectations
 * @property {string[] | undefined} bugs
 * @property {string[] | undefined} modifiers
 * @property {string | undefined} comment
 */

/**
 * @returns {TestExpectation[]}
 */
function getTestExpectations() {
  const expectationsPath = join(cwd, "test", "expectations.txt");
  if (!existsSync(expectationsPath)) {
    return [];
  }
  const lines = readFileSync(expectationsPath, "utf-8").split(/\r?\n/);

  /** @type {TestExpectation[]} */
  const expectations = [];

  for (const line of lines) {
    const content = line.trim();
    if (!content || content.startsWith("#")) {
      continue;
    }

    let comment;
    const commentIndex = content.indexOf("#");
    let cleanLine = content;
    if (commentIndex !== -1) {
      comment = content.substring(commentIndex + 1).trim();
      cleanLine = content.substring(0, commentIndex).trim();
    }

    let modifiers = [];
    let remaining = cleanLine;
    let modifierMatch = remaining.match(/^\[(.*?)\]/);
    if (modifierMatch) {
      modifiers = modifierMatch[1].trim().split(/\s+/);
      remaining = remaining.substring(modifierMatch[0].length).trim();
    }

    let expectationValues = ["Skip"];
    const expectationMatch = remaining.match(/\[(.*?)\]$/);
    if (expectationMatch) {
      expectationValues = expectationMatch[1].trim().split(/\s+/);
      remaining = remaining.substring(0, remaining.length - expectationMatch[0].length).trim();
    }

    const filename = remaining.trim();
    if (filename) {
      expectations.push({
        filename,
        expectations: expectationValues,
        bugs: undefined,
        modifiers: modifiers.length ? modifiers : undefined,
        comment,
      });
    }
  }

  return expectations;
}

const skipsForExceptionValidation = (() => {
  const path = join(cwd, "test/no-validate-exceptions.txt");
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf-8")
    .split("\n")
    .map(line => line.trim())
    .filter(line => !line.startsWith("#") && line.length > 0);
})();

const skipsForLeaksan = (() => {
  const path = join(cwd, "test/no-validate-leaksan.txt");
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter(line => !line.startsWith("#") && line.length > 0);
})();

/**
 * Returns whether we should validate exception checks running the given test
 * @param {string} test
 * @returns {boolean}
 */
const shouldValidateExceptions = test => {
  return !(skipsForExceptionValidation.includes(test) || skipsForExceptionValidation.includes("test/" + test));
};

/**
 * Returns whether we should validate exception checks running the given test
 * @param {string} test
 * @returns {boolean}
 */
const shouldValidateLeakSan = test => {
  return !(skipsForLeaksan.includes(test) || skipsForLeaksan.includes("test/" + test));
};

/**
 * @param {string} testPath
 * @returns {string[]}
 */
function getTestModifiers(testPath) {
  const ext = extname(testPath);
  const filename = basename(testPath, ext);
  const modifiers = filename.split("-").filter(value => value !== "bun");

  const os = getOs();
  const arch = getArch();
  modifiers.push(os, arch, `${os}-${arch}`);

  const distro = getDistro();
  if (distro) {
    modifiers.push(distro, `${os}-${distro}`, `${os}-${arch}-${distro}`);
    const distroVersion = getDistroVersion();
    if (distroVersion) {
      modifiers.push(
        distroVersion,
        `${distro}-${distroVersion}`,
        `${os}-${distro}-${distroVersion}`,
        `${os}-${arch}-${distro}-${distroVersion}`,
      );
    }
  }

  const abi = getAbi();
  if (abi) {
    modifiers.push(abi, `${os}-${abi}`, `${os}-${arch}-${abi}`);
    const abiVersion = getAbiVersion();
    if (abiVersion) {
      modifiers.push(
        abiVersion,
        `${abi}-${abiVersion}`,
        `${os}-${abi}-${abiVersion}`,
        `${os}-${arch}-${abi}-${abiVersion}`,
      );
    }
  }

  return modifiers.map(value => value.toUpperCase());
}

/**
 * @returns {Promise<TestResult[]>}
 */
async function runTests() {
  let execPath;
  if (options["step"]) {
    execPath = await getExecPathFromBuildKite(options["step"], options["build-id"]);
  } else {
    execPath = getExecPath(options["exec-path"]);
  }
  !isQuiet && console.log("Bun:", execPath);

  const expectations = getTestExpectations();
  const modifiers = getTestModifiers(execPath);
  !isQuiet && console.log("Modifiers:", modifiers);

  const revision = getRevision(execPath);
  !isQuiet && console.log("Revision:", revision);

  const tests = getRelevantTests(testsPath, modifiers, expectations);
  !isQuiet && console.log("Running tests:", tests.length);

  /** @type {VendorTest[] | undefined} */
  let vendorTests;
  let vendorTotal = 0;
  if (/true|1|yes|on/i.test(options["vendor"]) || (isCI && typeof options["vendor"] === "undefined")) {
    vendorTests = await getVendorTests(cwd);
    if (vendorTests.length) {
      vendorTotal = vendorTests.reduce((total, { testPaths }) => total + testPaths.length + 1, 0);
      !isQuiet && console.log("Running vendor tests:", vendorTotal);
    }
  }

  let i = 0;
  let total = vendorTotal + tests.length + 2;

  const okResults = [];
  const flakyResults = [];
  const flakyResultsTitles = [];
  const failedResults = [];
  const failedResultsTitles = [];
  const maxAttempts = 1 + (parseInt(options["retries"]) || 0);

  const parallelism = options["parallel"] ? availableParallelism() : 1;
  console.log("parallelism", parallelism);
  const limit = pLimit(parallelism);

  /**
   * @param {string} title
   * @param {function} fn
   * @returns {Promise<TestResult>}
   */
  const runTest = async (title, fn) => {
    const index = ++i;

    let result, failure, flaky;
    let attempt = 1;
    for (; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        await new Promise(resolve => setTimeout(resolve, 5000 + Math.random() * 10_000));
      }

      let grouptitle = `${getAnsi("gray")}[${index}/${total}]${getAnsi("reset")} ${title}`;
      if (attempt > 1) grouptitle += ` ${getAnsi("gray")}[attempt #${attempt}]${getAnsi("reset")}`;

      if (parallelism > 1) {
        console.log(grouptitle);
        result = await fn(index);
      } else {
        result = await startGroup(grouptitle, fn);
      }

      const { ok, stdoutPreview, error } = result;
      if (ok) {
        if (failure) {
          flakyResults.push(failure);
          flakyResultsTitles.push(title);
        } else {
          okResults.push(result);
        }
        break;
      }

      const color = attempt >= maxAttempts ? "red" : "yellow";
      const label = `${getAnsi(color)}[${index}/${total}] ${title} - ${error}${getAnsi("reset")}`;
      startGroup(label, () => {
        if (parallelism > 1) return;
        if (!isCI) return;
        process.stderr.write(stdoutPreview);
      });

      failure ||= result;
      flaky ||= true;

      if (attempt >= maxAttempts || isAlwaysFailure(error)) {
        flaky = false;
        failedResults.push(failure);
        failedResultsTitles.push(title);
        break;
      }
    }

    if (!failure) {
      return result;
    }

    if (isBuildkite) {
      // Group flaky tests together, regardless of the title
      const context = flaky ? "flaky" : title;
      const style = flaky ? "warning" : "error";
      if (!flaky) attempt = 1; // no need to show the retries count on failures, we know it maxed out

      if (title.startsWith("vendor")) {
        const content = formatTestToMarkdown({ ...failure, testPath: title }, false, attempt - 1);
        if (content) {
          reportAnnotationToBuildKite({ context, label: title, content, style });
        }
      } else {
        const content = formatTestToMarkdown(failure, false, attempt - 1);
        if (content) {
          reportAnnotationToBuildKite({ context, label: title, content, style });
        }
      }
    }

    if (isGithubAction) {
      const summaryPath = process.env["GITHUB_STEP_SUMMARY"];
      if (summaryPath) {
        const longMarkdown = formatTestToMarkdown(failure, false, attempt - 1);
        appendFileSync(summaryPath, longMarkdown);
      }
      const shortMarkdown = formatTestToMarkdown(failure, true, attempt - 1);
      appendFileSync("comment.md", shortMarkdown);
    }

    if (options["bail"]) {
      process.exit(getExitCode("fail"));
    }

    return result;
  };

  if (!isQuiet) {
    for (const path of [cwd, testsPath]) {
      const title = relative(cwd, join(path, "package.json")).replace(/\\/g, "/");
      await runTest(title, async () => spawnBunInstall(execPath, { cwd: path }));
    }
  }

  if (!failedResults.length) {
    // TODO: remove windows exclusion here
    if (isCI && !isWindows) {
      // bun install has succeeded
      const { promise: portPromise, resolve: portResolve } = Promise.withResolvers();
      const { promise: errorPromise, resolve: errorResolve } = Promise.withResolvers();
      console.log("run in", cwd);
      let exiting = false;

      const server = spawn(execPath, ["run", "--silent", "ci-remap-server", execPath, cwd, getCommit()], {
        stdio: ["ignore", "pipe", "inherit"],
        cwd, // run in main repo
        env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1", NO_COLOR: "1" },
      });
      server.unref();
      server.on("error", errorResolve);
      server.on("exit", (code, signal) => {
        if (!exiting && (code !== 0 || signal !== null)) errorResolve(signal ? signal : "code " + code);
      });
      function onBeforeExit() {
        exiting = true;
        server.off("error");
        server.off("exit");
        server.kill?.();
      }
      process.once("beforeExit", onBeforeExit);
      const lines = createInterface(server.stdout);
      lines.on("line", line => {
        portResolve({ port: parseInt(line) });
      });

      const result = await Promise.race([portPromise, errorPromise.catch(e => e), setTimeoutPromise(5000, "timeout")]);
      if (typeof result?.port != "number") {
        process.off("beforeExit", onBeforeExit);
        server.kill?.();
        console.warn("ci-remap server did not start:", result);
      } else {
        console.log("crash reports parsed on port", result.port);
        remapPort = result.port;
      }
    }

    await Promise.all(
      tests.map(testPath =>
        limit(() => {
          const absoluteTestPath = join(testsPath, testPath);
          const title = relative(cwd, absoluteTestPath).replaceAll(sep, "/");
          if (isNodeTest(testPath)) {
            const testContent = readFileSync(absoluteTestPath, "utf-8");
            let runWithBunTest = title.includes("needs-test") || testContent.includes("node:test");
            // don't wanna have a filter for includes("bun:test") but these need our mocks
            runWithBunTest ||= title === "test/js/node/test/parallel/test-fs-append-file-flush.js";
            runWithBunTest ||= title === "test/js/node/test/parallel/test-fs-write-file-flush.js";
            runWithBunTest ||= title === "test/js/node/test/parallel/test-fs-write-stream-flush.js";
            const subcommand = runWithBunTest ? "test" : "run";
            const env = {
              FORCE_COLOR: "0",
              NO_COLOR: "1",
              BUN_DEBUG_QUIET_LOGS: "1",
            };
            if ((basename(execPath).includes("asan") || !isCI) && shouldValidateExceptions(testPath)) {
              env.BUN_JSC_validateExceptionChecks = "1";
              env.BUN_JSC_dumpSimulatedThrows = "1";
            }
            if ((basename(execPath).includes("asan") || !isCI) && shouldValidateLeakSan(testPath)) {
              env.BUN_DESTRUCT_VM_ON_EXIT = "1";
              env.ASAN_OPTIONS = "allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1";
              // prettier-ignore
              env.LSAN_OPTIONS = `malloc_context_size=100:print_suppressions=0:suppressions=${process.cwd()}/test/leaksan.supp`;
            }
            return runTest(title, async () => {
              const { ok, error, stdout, crashes } = await spawnBun(execPath, {
                cwd: cwd,
                args: [
                  subcommand,
                  "--config=" + join(import.meta.dirname, "../bunfig.node-test.toml"),
                  absoluteTestPath,
                ],
                timeout: getNodeParallelTestTimeout(title),
                env,
                stdout: parallelism > 1 ? () => {} : chunk => pipeTestStdout(process.stdout, chunk),
                stderr: parallelism > 1 ? () => {} : chunk => pipeTestStdout(process.stderr, chunk),
              });
              const mb = 1024 ** 3;
              let stdoutPreview = stdout.slice(0, mb).split("\n").slice(0, 50).join("\n");
              if (crashes) stdoutPreview += crashes;
              return {
                testPath: title,
                ok: ok,
                status: ok ? "pass" : "fail",
                error: error,
                errors: [],
                tests: [],
                stdout: stdout,
                stdoutPreview: stdoutPreview,
              };
            });
          } else {
            return runTest(title, async () =>
              spawnBunTest(execPath, join("test", testPath), {
                cwd,
                stdout: parallelism > 1 ? () => {} : chunk => pipeTestStdout(process.stdout, chunk),
                stderr: parallelism > 1 ? () => {} : chunk => pipeTestStdout(process.stderr, chunk),
              }),
            );
          }
        }),
      ),
    );
  }

  if (vendorTests?.length) {
    for (const { cwd: vendorPath, packageManager, testRunner, testPaths } of vendorTests) {
      if (!testPaths.length) {
        continue;
      }

      const packageJson = join(relative(cwd, vendorPath), "package.json").replace(/\\/g, "/");
      if (packageManager === "bun") {
        const { ok } = await runTest(packageJson, () => spawnBunInstall(execPath, { cwd: vendorPath }));
        if (!ok) {
          continue;
        }
      } else {
        throw new Error(`Unsupported package manager: ${packageManager}`);
      }

      // build
      const buildResult = await spawnBun(execPath, {
        cwd: vendorPath,
        args: ["run", "build"],
        timeout: 60_000,
      });
      if (!buildResult.ok) {
        throw new Error(`Failed to build vendor: ${buildResult.error}`);
      }

      for (const testPath of testPaths) {
        const title = join(relative(cwd, vendorPath), testPath).replace(/\\/g, "/");

        if (testRunner === "bun") {
          await runTest(title, index =>
            spawnBunTest(execPath, testPath, { cwd: vendorPath, env: { TEST_SERIAL_ID: index } }),
          );
        } else {
          const testRunnerPath = join(cwd, "test", "runners", `${testRunner}.ts`);
          if (!existsSync(testRunnerPath)) {
            throw new Error(`Unsupported test runner: ${testRunner}`);
          }
          await runTest(title, () =>
            spawnBunTest(execPath, testPath, {
              cwd: vendorPath,
              args: ["--preload", testRunnerPath],
            }),
          );
        }
      }
    }
  }

  // tests are all over, close the group from the final test. any further output should print ungrouped.
  startGroup("End");

  if (isGithubAction) {
    reportOutputToGitHubAction("failing_tests_count", failedResults.length);
    const markdown = formatTestToMarkdown(failedResults, false, 0);
    reportOutputToGitHubAction("failing_tests", markdown);
  }

  // Generate and upload JUnit reports if requested
  if (options["junit"]) {
    const junitTempDir = options["junit-temp-dir"];
    mkdirSync(junitTempDir, { recursive: true });

    // Generate JUnit reports for tests that don't use bun test
    const nonBunTestResults = [...okResults, ...flakyResults, ...failedResults].filter(result => {
      // Check if this is a test that wasn't run with bun test
      const isNodeTest =
        isJavaScript(result.testPath) && !isTestStrict(result.testPath) && !result.testPath.includes("vendor");
      return isNodeTest;
    });

    // If we have tests not covered by bun test JUnit reports, generate a report for them
    if (nonBunTestResults.length > 0) {
      const nonBunTestJunitPath = join(junitTempDir, "non-bun-test-results.xml");
      generateJUnitReport(nonBunTestJunitPath, nonBunTestResults);
      !isQuiet &&
        console.log(
          `Generated JUnit report for ${nonBunTestResults.length} non-bun test results at ${nonBunTestJunitPath}`,
        );

      // Upload this report immediately if we're on BuildKite
      if (isBuildkite && options["junit-upload"]) {
        const uploadSuccess = await uploadJUnitToBuildKite(nonBunTestJunitPath);
        if (uploadSuccess) {
          // Delete the file after successful upload to prevent redundant uploads
          try {
            unlinkSync(nonBunTestJunitPath);
            !isQuiet && console.log(`Uploaded and deleted non-bun test JUnit report`);
          } catch (unlinkError) {
            !isQuiet && console.log(`Uploaded but failed to delete non-bun test JUnit report: ${unlinkError.message}`);
          }
        } else {
          !isQuiet && console.log(`Failed to upload non-bun test JUnit report to BuildKite`);
        }
      }
    }

    // Check for any JUnit reports that may not have been uploaded yet
    // Since we're deleting files after upload, any remaining files need to be uploaded
    if (isBuildkite && options["junit-upload"]) {
      try {
        // Only process XML files and skip the non-bun test results which we've already uploaded
        const allJunitFiles = readdirSync(junitTempDir).filter(
          file => file.endsWith(".xml") && file !== "non-bun-test-results.xml",
        );

        if (allJunitFiles.length > 0) {
          !isQuiet && console.log(`Found ${allJunitFiles.length} remaining JUnit reports to upload...`);

          // Process each remaining JUnit file - these are files we haven't processed yet
          let uploadedCount = 0;

          for (const file of allJunitFiles) {
            const filePath = join(junitTempDir, file);

            if (existsSync(filePath)) {
              try {
                const uploadSuccess = await uploadJUnitToBuildKite(filePath);
                if (uploadSuccess) {
                  // Delete the file after successful upload
                  try {
                    unlinkSync(filePath);
                    uploadedCount++;
                  } catch (unlinkError) {
                    !isQuiet && console.log(`Uploaded but failed to delete ${file}: ${unlinkError.message}`);
                  }
                }
              } catch (err) {
                console.error(`Error uploading JUnit file ${file}:`, err);
              }
            }
          }

          if (uploadedCount > 0) {
            !isQuiet && console.log(`Uploaded and deleted ${uploadedCount} remaining JUnit reports`);
          } else {
            !isQuiet && console.log(`No JUnit reports needed to be uploaded`);
          }
        } else {
          !isQuiet && console.log(`No remaining JUnit reports found to upload`);
        }
      } catch (err) {
        console.error(`Error checking for remaining JUnit reports:`, err);
      }
    }
  }

  if (options["coredump-upload"]) {
    try {
      const coresDirBase = dirname(coresDir);
      const coresDirName = basename(coresDir);
      const coreFileNames = readdirSync(coresDir);

      if (coreFileNames.length > 0) {
        console.log(`found ${coreFileNames.length} cores in ${coresDir}`);
        let totalBytes = 0;
        let totalBlocks = 0;
        for (const f of coreFileNames) {
          const stat = statSync(join(coresDir, f));
          totalBytes += stat.size;
          totalBlocks += stat.blocks;
        }
        console.log(`total apparent size = ${totalBytes} bytes`);
        console.log(`total size on disk = ${512 * totalBlocks} bytes`);
        const outdir = mkdtempSync(join(tmpdir(), "cores-upload"));
        const outfileName = `${coresDirName}.tar.gz.age`;
        const outfileAbs = join(outdir, outfileName);

        // This matches an age identity known by Bun employees. Core dumps from CI have to be kept
        // secret since they will contain API keys.
        const ageRecipient = "age1eunsrgxwjjpzr48hm0y98cw2vn5zefjagt4r0qj4503jg2nxedqqkmz6fu"; // reject external PRs changing this, see above

        // Run tar in the parent directory of coresDir so that it creates archive entries with
        // coresDirName in them. This way when you extract the tarball you get a folder named
        // bun-cores-XYZ containing core files, instead of a bunch of core files strewn in your
        // current directory
        const before = Date.now();
        const zipAndEncrypt = await spawnSafe({
          command: "bash",
          args: [
            "-c",
            // tar -S: handle sparse files efficiently
            `set -euo pipefail && tar -Sc "$0" | gzip -1 | age -e -r ${ageRecipient} -o "$1"`,
            // $0
            coresDirName,
            // $1
            outfileAbs,
          ],
          cwd: coresDirBase,
          stdout: () => {},
          timeout: 60_000,
        });
        const elapsed = Date.now() - before;
        if (!zipAndEncrypt.ok) {
          throw new Error(zipAndEncrypt.error);
        }
        console.log(`saved core dumps to ${outfileAbs} (${statSync(outfileAbs).size} bytes) in ${elapsed} ms`);
        await uploadArtifact(outfileAbs);
      } else {
        console.log(`no cores found in ${coresDir}`);
      }
    } catch (err) {
      console.error("Error collecting and uploading core dumps:", err);
    }
  }

  if (!isCI && !isQuiet) {
    console.table({
      "Total Tests": okResults.length + failedResults.length + flakyResults.length,
      "Passed Tests": okResults.length,
      "Failing Tests": failedResults.length,
      "Flaky Tests": flakyResults.length,
    });

    if (failedResults.length) {
      console.log(`${getAnsi("red")}Failing Tests:${getAnsi("reset")}`);
      for (const testPath of failedResultsTitles) {
        console.log(`${getAnsi("red")}- ${testPath}${getAnsi("reset")}`);
      }
    }

    if (flakyResults.length) {
      console.log(`${getAnsi("yellow")}Flaky Tests:${getAnsi("reset")}`);
      for (const testPath of flakyResultsTitles) {
        console.log(`${getAnsi("yellow")}- ${testPath}${getAnsi("reset")}`);
      }
    }
  }

  // Exclude flaky tests from the final results
  return [...okResults, ...failedResults];
}

/**
 * @typedef {object} SpawnOptions
 * @property {string} command
 * @property {string[]} [args]
 * @property {string} [cwd]
 * @property {number} [timeout]
 * @property {object} [env]
 * @property {function} [stdout]
 * @property {function} [stderr]
 */

/**
 * @typedef {object} SpawnResult
 * @property {boolean} ok
 * @property {string} [error]
 * @property {Error} [spawnError]
 * @property {number} [exitCode]
 * @property {number} [signalCode]
 * @property {number} timestamp
 * @property {number} duration
 * @property {string} stdout
 * @property {number} [pid]
 */

/**
 * @param {SpawnOptions} options
 * @returns {Promise<SpawnResult>}
 */
async function spawnSafe(options) {
  const {
    command,
    args,
    cwd,
    env,
    timeout = spawnTimeout,
    stdout = process.stdout.write.bind(process.stdout),
    stderr = process.stderr.write.bind(process.stderr),
    retries = 0,
  } = options;
  let exitCode;
  let signalCode;
  let spawnError;
  let timestamp;
  let duration;
  let subprocess;
  let timer;
  let buffer = "";
  let doneCalls = 0;
  const beforeDone = resolve => {
    // TODO: wait for stderr as well, spawn.test currently causes it to hang
    if (doneCalls++ === 1) {
      done(resolve);
    }
  };
  const done = resolve => {
    if (timer) {
      clearTimeout(timer);
    }
    subprocess.stderr.unref();
    subprocess.stdout.unref();
    subprocess.unref();
    if (!signalCode && exitCode === undefined) {
      subprocess.stdout.destroy();
      subprocess.stderr.destroy();
      if (!subprocess.killed) {
        subprocess.kill(9);
      }
    }
    resolve();
  };
  await new Promise(resolve => {
    try {
      function unsafeBashEscape(str) {
        if (!str) return "";
        if (str.includes(" ")) return JSON.stringify(str);
        return str;
      }
      if (process.env.SHOW_SPAWN_COMMANDS) {
        console.log(
          "SPAWNING COMMAND:\n" +
            [
              "echo -n | " +
                Object.entries(env)
                  .map(([key, value]) => `${unsafeBashEscape(key)}=${unsafeBashEscape(value)}`)
                  .join(" "),
              unsafeBashEscape(command),
              ...args.map(unsafeBashEscape),
            ].join(" ") +
            " | cat",
        );
      }
      subprocess = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        timeout,
        cwd,
        env,
      });
      subprocess.on("spawn", () => {
        timestamp = Date.now();
        timer = setTimeout(() => done(resolve), timeout);
      });
      subprocess.on("error", error => {
        spawnError = error;
        done(resolve);
      });
      subprocess.on("exit", (code, signal) => {
        duration = Date.now() - timestamp;
        exitCode = code;
        signalCode = signal;
        if (signalCode || exitCode !== 0) {
          beforeDone(resolve);
        } else {
          done(resolve);
        }
      });
      subprocess.stdout.on("end", () => {
        beforeDone(resolve);
      });
      subprocess.stdout.on("data", chunk => {
        const text = chunk.toString("utf-8");
        stdout?.(text);
        buffer += text;
      });
      subprocess.stderr.on("data", chunk => {
        const text = chunk.toString("utf-8");
        stderr?.(text);
        buffer += text;
      });
    } catch (error) {
      spawnError = error;
      resolve();
    }
  });
  if (spawnError && retries < 5) {
    const { code } = spawnError;
    if (code === "EBUSY" || code === "UNKNOWN") {
      await new Promise(resolve => setTimeout(resolve, 1000 * (retries + 1)));
      return spawnSafe({
        ...options,
        retries: retries + 1,
      });
    }
  }
  let error;
  if (exitCode === 0) {
    // ...
  } else if (spawnError) {
    const { stack, message } = spawnError;
    if (/timed? ?out/.test(message)) {
      error = "timeout";
    } else {
      error = "spawn error";
      buffer = stack || message;
    }
  } else if (
    (error = /thread \d+ panic: (.*)(?:\r\n|\r|\n|\\n)/i.exec(buffer)) ||
    (error = /panic\(.*\): (.*)(?:\r\n|\r|\n|\\n)/i.exec(buffer)) ||
    (error = /(Segmentation fault) at address/i.exec(buffer)) ||
    (error = /(Internal assertion failure)/i.exec(buffer)) ||
    (error = /(Illegal instruction) at address/i.exec(buffer)) ||
    (error = /panic: (.*) at address/i.exec(buffer)) ||
    (error = /oh no: Bun has crashed/i.exec(buffer)) ||
    (error = /(ERROR: AddressSanitizer)/.exec(buffer)) ||
    (error = /(SIGABRT)/.exec(buffer))
  ) {
    const [, message] = error || [];
    error = message ? message.split("\n")[0].toLowerCase() : "crash";
    error = error.indexOf("\\n") !== -1 ? error.substring(0, error.indexOf("\\n")) : error;
    error = `pid ${subprocess.pid} ${error}`;
  } else if (signalCode) {
    if (signalCode === "SIGTERM" && duration >= timeout) {
      error = "timeout";
    } else {
      error = signalCode;
    }
  } else if (exitCode === 1) {
    const match = buffer.match(/\x1b\[31m\s(\d+) fail/);
    if (match) {
      error = `${match[1]} failing`;
    } else {
      error = "code 1";
    }
  } else if (exitCode === undefined) {
    error = "timeout";
  } else if (exitCode !== 0) {
    if (isWindows) {
      const winCode = getWindowsExitReason(exitCode);
      if (winCode) {
        exitCode = winCode;
      }
    }
    error = `code ${exitCode}`;
  }
  return {
    ok: exitCode === 0 && !signalCode && !spawnError,
    error,
    exitCode,
    signalCode,
    spawnError,
    stdout: buffer,
    timestamp: timestamp || Date.now(),
    duration: duration || 0,
    pid: subprocess?.pid,
  };
}

let _combinedPath = "";
function getCombinedPath(execPath) {
  if (!_combinedPath) {
    _combinedPath = addPath(realpathSync(dirname(execPath)), process.env.PATH);
    // If we're running bun-profile.exe, try to make a symlink to bun.exe so
    // that anything looking for "bun" will find it
    if (isCI && basename(execPath, extname(execPath)).toLowerCase() !== "bun") {
      const existingPath = execPath;
      const newPath = join(dirname(execPath), "bun" + extname(execPath));
      try {
        // On Windows, we might run into permissions issues with symlinks.
        // If that happens, fall back to a regular hardlink.
        symlinkSync(existingPath, newPath, "file");
      } catch (error) {
        try {
          linkSync(existingPath, newPath);
        } catch (error) {
          console.warn(`Failed to link bun`, error);
        }
      }
    }
  }
  return _combinedPath;
}

/**
 * @typedef {object} SpawnBunResult
 * @extends SpawnResult
 * @property {string} [crashes]
 */

/**
 * @param {string} execPath Path to bun binary
 * @param {SpawnOptions} options
 * @returns {Promise<SpawnBunResult>}
 */
async function spawnBun(execPath, { args, cwd, timeout, env, stdout, stderr }) {
  const path = getCombinedPath(execPath);
  const tmpdirPath = mkdtempSync(join(tmpdir(), "buntmp-"));
  const { username, homedir } = userInfo();
  const shellPath = getShell();
  const bunEnv = {
    ...process.env,
    PATH: path,
    TMPDIR: tmpdirPath,
    BUN_TMPDIR: tmpdirPath,
    USER: username,
    HOME: homedir,
    SHELL: shellPath,
    FORCE_COLOR: "1",
    BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1",
    BUN_DEBUG_QUIET_LOGS: "1",
    BUN_GARBAGE_COLLECTOR_LEVEL: "1",
    BUN_JSC_randomIntegrityAuditRate: "1.0",
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
    BUN_INSTALL_CACHE_DIR: tmpdirPath,
    SHELLOPTS: isWindows ? "igncr" : undefined, // ignore "\r" on Windows
    TEST_TMPDIR: tmpdirPath, // Used in Node.js tests.
    ...(typeof remapPort == "number"
      ? { BUN_CRASH_REPORT_URL: `http://localhost:${remapPort}` }
      : { BUN_ENABLE_CRASH_REPORTING: "0" }),
  };

  if (isWindows && bunEnv.Path) {
    delete bunEnv.Path;
  }

  if (env) {
    Object.assign(bunEnv, env);
  }

  if (isWindows) {
    delete bunEnv["PATH"];
    bunEnv["Path"] = path;
    for (const tmpdir of ["TMPDIR", "TEMP", "TEMPDIR", "TMP"]) {
      delete bunEnv[tmpdir];
    }
    bunEnv["TEMP"] = tmpdirPath;
  }
  if (timeout === undefined) {
    timeout = spawnBunTimeout;
  }
  try {
    const existingCores = options["coredump-upload"] ? readdirSync(coresDir) : [];
    const result = await spawnSafe({
      command: execPath,
      args,
      cwd,
      timeout,
      env: bunEnv,
      stdout,
      stderr,
    });
    const newCores = options["coredump-upload"] ? readdirSync(coresDir).filter(c => !existingCores.includes(c)) : [];
    let crashes = "";
    if (options["coredump-upload"] && (result.signalCode !== null || newCores.length > 0)) {
      // warn if the main PID crashed and we don't have a core
      if (result.signalCode !== null && !newCores.some(c => c.endsWith(`${result.pid}.core`))) {
        crashes += `main process killed by ${result.signalCode} but no core file found\n`;
      }

      if (newCores.length > 0) {
        result.ok = false;
        if (!isAlwaysFailure(result.error)) result.error = "core dumped";
      }

      for (const coreName of newCores) {
        const corePath = join(coresDir, coreName);
        let out = "";
        const gdb = await spawnSafe({
          command: "gdb",
          args: ["-batch", `--eval-command=bt`, "--core", corePath, execPath],
          timeout: 240_000,
          stderr: () => {},
          stdout(text) {
            out += text;
          },
        });
        if (!gdb.ok) {
          crashes += `failed to get backtrace from GDB: ${gdb.error}\n`;
        } else {
          crashes += `======== Stack trace from GDB for ${coreName}: ========\n`;
          for (const line of out.split("\n")) {
            // filter GDB output since it is pretty verbose
            if (
              line.startsWith("Program terminated") ||
              line.startsWith("#") || // gdb backtrace lines start with #0, #1, etc.
              line.startsWith("[Current thread is")
            ) {
              crashes += line + "\n";
            }
          }
        }
      }
    }

    // Skip this if the remap server didn't work or if Bun exited normally
    // (tests in which a subprocess crashed should at least set exit code 1)
    if (typeof remapPort == "number" && result.exitCode !== 0) {
      try {
        // When Bun crashes, it exits before the subcommand it runs to upload the crash report has necessarily finished.
        // So wait a little bit to make sure that the crash report has at least started uploading
        // (once the server sees the /ack request then /traces will wait for any crashes to finish processing)
        // There is a bug that if a test causes crash reports but exits with code 0, the crash reports will instead
        // be attributed to the next test that fails. I'm not sure how to fix this without adding a sleep in between
        // all tests (which would slow down CI a lot).
        await setTimeoutPromise(500);
        const response = await fetch(`http://localhost:${remapPort}/traces`);
        if (!response.ok || response.status !== 200) throw new Error(`server responded with code ${response.status}`);
        const traces = await response.json();
        if (traces.length > 0) {
          result.ok = false;
          if (!isAlwaysFailure(result.error)) result.error = "crash reported";

          crashes += `${traces.length} crashes reported during this test\n`;
          for (const t of traces) {
            if (t.failed_parse) {
              crashes += "Trace string failed to parse:\n";
              crashes += t.failed_parse + "\n";
            } else if (t.failed_remap) {
              crashes += "Parsed trace failed to remap:\n";
              crashes += JSON.stringify(t.failed_remap, null, 2) + "\n";
            } else {
              crashes += "================\n";
              crashes += t.remap + "\n";
            }
          }
        }
      } catch (e) {
        crashes += "failed to fetch traces: " + e.toString() + "\n";
      }
    }
    if (crashes.length > 0) result.crashes = crashes;
    return result;
  } finally {
    try {
      rmSync(tmpdirPath, { recursive: true, force: true });
    } catch (error) {
      console.warn(error);
    }
  }
}

/**
 * @typedef {object} TestResult
 * @property {string} testPath
 * @property {boolean} ok
 * @property {string} status
 * @property {string} [error]
 * @property {TestEntry[]} tests
 * @property {string} stdout
 * @property {string} stdoutPreview
 */

/**
 * @typedef {object} TestEntry
 * @property {string} [url]
 * @property {string} file
 * @property {string} test
 * @property {string} status
 * @property {TestError} [error]
 * @property {number} [duration]
 */

/**
 * @typedef {object} TestError
 * @property {string} [url]
 * @property {string} file
 * @property {number} line
 * @property {number} col
 * @property {string} name
 * @property {string} stack
 */

/**
 *
 * @param {string} execPath
 * @param {string} testPath
 * @param {object} [opts]
 * @param {string} [opts.cwd]
 * @param {string[]} [opts.args]
 * @param {object} [opts.env]
 * @returns {Promise<TestResult>}
 */
async function spawnBunTest(execPath, testPath, opts = { cwd }) {
  const timeout = getTestTimeout(testPath);
  const perTestTimeout = Math.ceil(timeout / 2);
  const absPath = join(opts["cwd"], testPath);
  const isReallyTest = isTestStrict(testPath) || absPath.includes("vendor");
  const args = opts["args"] ?? [];

  const testArgs = ["test", ...args, `--timeout=${perTestTimeout}`];

  // This will be set if a JUnit file is generated
  let junitFilePath = null;

  // In CI, we want to use JUnit for all tests
  // Create a unique filename for each test run using a hash of the test path
  // This ensures we can run tests in parallel without file conflicts
  if (cliOptions.junit) {
    const testHash = createHash("sha1").update(testPath).digest("base64url");
    const junitTempDir = cliOptions["junit-temp-dir"];

    // Create the JUnit file path
    junitFilePath = `${junitTempDir}/test-${testHash}.xml`;

    // Add JUnit reporter
    testArgs.push("--reporter=junit");
    testArgs.push(`--reporter-outfile=${junitFilePath}`);
  }

  testArgs.push(absPath);

  const env = {
    GITHUB_ACTIONS: "true", // always true so annotations are parsed
    ...opts["env"],
  };
  if ((basename(execPath).includes("asan") || !isCI) && shouldValidateExceptions(relative(cwd, absPath))) {
    env.BUN_JSC_validateExceptionChecks = "1";
    env.BUN_JSC_dumpSimulatedThrows = "1";
  }
  if ((basename(execPath).includes("asan") || !isCI) && shouldValidateLeakSan(relative(cwd, absPath))) {
    env.BUN_DESTRUCT_VM_ON_EXIT = "1";
    env.ASAN_OPTIONS = "allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1";
    // prettier-ignore
    env.LSAN_OPTIONS = `malloc_context_size=100:print_suppressions=0:suppressions=${process.cwd()}/test/leaksan.supp`;
  }

  const { ok, error, stdout, crashes } = await spawnBun(execPath, {
    args: isReallyTest ? testArgs : [...args, absPath],
    cwd: opts["cwd"],
    timeout: isReallyTest ? timeout : 30_000,
    env,
    stdout: options.stdout,
    stderr: options.stderr,
  });
  let { tests, errors, stdout: stdoutPreview } = parseTestStdout(stdout, testPath);
  if (crashes) stdoutPreview += crashes;

  // If we generated a JUnit file and we're on BuildKite, upload it immediately
  if (junitFilePath && isReallyTest && isBuildkite && cliOptions["junit-upload"]) {
    // Give the file system a moment to finish writing the file
    if (existsSync(junitFilePath)) {
      addToJunitUploadQueue(junitFilePath);
    }
  }

  return {
    testPath,
    ok,
    status: ok ? "pass" : "fail",
    error,
    errors,
    tests,
    stdout,
    stdoutPreview,
  };
}

/**
 * @param {string} testPath
 * @returns {number}
 */
function getTestTimeout(testPath) {
  if (/integration|3rd_party|docker|bun-install-registry|v8/i.test(testPath)) {
    return integrationTimeout;
  }
  return testTimeout;
}

/**
 * @param {NodeJS.WritableStream} io
 * @param {string} chunk
 */
function pipeTestStdout(io, chunk) {
  if (isGithubAction) {
    io.write(chunk.replace(/\:\:(?:end)?group\:\:.*(?:\r\n|\r|\n)/gim, ""));
  } else if (isBuildkite) {
    io.write(chunk.replace(/(?:---|\+\+\+|~~~|\^\^\^) /gim, " ").replace(/\:\:.*(?:\r\n|\r|\n)/gim, ""));
  } else {
    io.write(chunk.replace(/\:\:.*(?:\r\n|\r|\n)/gim, ""));
  }
}

/**
 * @typedef {object} TestOutput
 * @property {string} stdout
 * @property {TestResult[]} tests
 * @property {TestError[]} errors
 */

/**
 * @param {string} stdout
 * @param {string} [testPath]
 * @returns {TestOutput}
 */
function parseTestStdout(stdout, testPath) {
  const tests = [];
  const errors = [];

  let lines = [];
  let skipCount = 0;
  let testErrors = [];
  let done;
  for (const chunk of stdout.split("\n")) {
    const string = stripAnsi(chunk);

    if (!string.startsWith("::")) {
      lines.push(chunk);

      if (string.startsWith("✓") || string.startsWith("»") || string.startsWith("✎")) {
        skipCount++;
      } else {
        // If there are more than 3 consecutive non-failing tests,
        // omit the non-failing tests between them.
        if (skipCount > 3) {
          const removeStart = lines.length - skipCount;
          const removeCount = skipCount - 2;
          const omitLine = `${getAnsi("gray")}... omitted ${removeCount} tests ...${getAnsi("reset")}`;
          lines.splice(removeStart, removeCount, omitLine);
        }
        skipCount = 0;
      }
    }

    // Once the summary is printed, exit early so tests aren't double counted.
    // This needs to be changed if multiple files are run in a single test run.
    if (done || string.startsWith("::endgroup")) {
      done ||= true;
      continue;
    }

    if (string.startsWith("::error")) {
      const eol = string.indexOf("::", 8);
      const message = unescapeGitHubAction(string.substring(eol + 2));
      const { file, line, col, title } = Object.fromEntries(
        string
          .substring(8, eol)
          .split(",")
          .map(entry => entry.split("=")),
      );

      const errorPath = file || testPath;
      const error = {
        url: getFileUrl(errorPath, line),
        file: errorPath,
        line,
        col,
        name: title,
        stack: `${title}\n${message}`,
      };

      errors.push(error);
      testErrors.push(error);
      continue;
    }

    for (const { emoji, text } of [
      { emoji: "✓", text: "pass" },
      { emoji: "✗", text: "fail" },
      { emoji: "»", text: "skip" },
      { emoji: "✎", text: "todo" },
    ]) {
      if (!string.startsWith(emoji)) {
        continue;
      }

      const eol = string.lastIndexOf(" [") || undefined;
      const test = string.substring(1 + emoji.length, eol);
      const duration = eol ? string.substring(eol + 2, string.lastIndexOf("]")) : undefined;

      tests.push({
        url: getFileUrl(testPath),
        file: testPath,
        test,
        status: text,
        errors: testErrors,
        duration: parseDuration(duration),
      });

      for (let error of testErrors) {
        error.test = test;
      }
      testErrors = [];
    }
  }

  let preview;
  const removeCount = lines.length - 100;
  if (removeCount > 10) {
    const omitLine = `${getAnsi("gray")}... omitted ${removeCount} lines ...${getAnsi("reset")}\n`;
    preview = [omitLine, ...lines.slice(-100)].join("\n");
  } else {
    preview = lines.join("\n");
  }

  return {
    tests,
    errors,
    stdout: preview,
  };
}

/**
 * @param {string} execPath
 * @param {SpawnOptions} options
 * @returns {Promise<TestResult>}
 */
async function spawnBunInstall(execPath, options) {
  let { ok, error, stdout, duration, crashes } = await spawnBun(execPath, {
    args: ["install"],
    timeout: testTimeout,
    ...options,
  });
  if (crashes) stdout += crashes;
  const relativePath = relative(cwd, options.cwd);
  const testPath = join(relativePath, "package.json");
  const status = ok ? "pass" : "fail";
  return {
    testPath,
    ok,
    status,
    error,
    errors: [],
    tests: [
      {
        file: testPath,
        test: "bun install",
        status,
        duration: parseDuration(duration),
      },
    ],
    stdout,
    stdoutPreview: stdout,
  };
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function isJavaScript(path) {
  return /\.(c|m)?(j|t)sx?$/.test(basename(path));
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function isJavaScriptTest(path) {
  return isJavaScript(path) && /\.test|spec\./.test(basename(path));
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function isNodeTest(path) {
  // Do not run node tests on macOS x64 in CI, those machines are slow and expensive.
  if (isCI && isMacOS && isX64) {
    return false;
  }
  if (!isJavaScript(path)) {
    return false;
  }
  const unixPath = path.replaceAll(sep, "/");
  return (
    unixPath.includes("js/node/test/parallel/") ||
    unixPath.includes("js/node/test/sequential/") ||
    unixPath.includes("js/bun/test/parallel/")
  );
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function isClusterTest(path) {
  const unixPath = path.replaceAll(sep, "/");
  return unixPath.includes("js/node/cluster/test-") && unixPath.endsWith(".ts");
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function isTest(path) {
  return isNodeTest(path) || isClusterTest(path) ? true : isTestStrict(path);
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function isTestStrict(path) {
  return isJavaScript(path) && /\.test|spec\./.test(basename(path));
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function isHidden(path) {
  return /node_modules|node.js/.test(dirname(path)) || /^\./.test(basename(path));
}

/**
 * @param {string} cwd
 * @returns {string[]}
 */
function getTests(cwd) {
  function* getFiles(cwd, path) {
    const dirname = join(cwd, path);
    for (const entry of readdirSync(dirname, { encoding: "utf-8", withFileTypes: true })) {
      const { name } = entry;
      const filename = join(path, name);
      if (isHidden(filename)) {
        continue;
      }
      if (entry.isFile()) {
        if (isTest(filename)) {
          yield filename;
        }
      } else if (entry.isDirectory()) {
        yield* getFiles(cwd, filename);
      }
    }
  }
  return [...getFiles(cwd, "")].sort();
}

/**
 * @typedef {object} Vendor
 * @property {string} package
 * @property {string} repository
 * @property {string} tag
 * @property {string} [packageManager]
 * @property {string} [testPath]
 * @property {string} [testRunner]
 * @property {string[]} [testExtensions]
 * @property {boolean | Record<string, boolean | string>} [skipTests]
 */

/**
 * @typedef {object} VendorTest
 * @property {string} cwd
 * @property {string} packageManager
 * @property {string} testRunner
 * @property {string[]} testPaths
 */

/**
 * @param {string} cwd
 * @returns {Promise<VendorTest[]>}
 */
async function getVendorTests(cwd) {
  const vendorPath = join(cwd, "test", "vendor.json");
  if (!existsSync(vendorPath)) {
    throw new Error(`Did not find vendor.json: ${vendorPath}`);
  }

  /** @type {Vendor[]} */
  const vendors = JSON.parse(readFileSync(vendorPath, "utf-8")).sort(
    (a, b) => a.package.localeCompare(b.package) || a.tag.localeCompare(b.tag),
  );

  const shardId = parseInt(options["shard"]);
  const maxShards = parseInt(options["max-shards"]);

  /** @type {Vendor[]} */
  let relevantVendors = [];
  if (maxShards > 1) {
    for (let i = 0; i < vendors.length; i++) {
      if (i % maxShards === shardId) {
        relevantVendors.push(vendors[i]);
      }
    }
  } else {
    relevantVendors = vendors.flat();
  }

  return Promise.all(
    relevantVendors.map(
      async ({ package: name, repository, tag, testPath, testExtensions, testRunner, packageManager, skipTests }) => {
        const vendorPath = join(cwd, "vendor", name);

        if (!existsSync(vendorPath)) {
          const { ok, error } = await spawnSafe({
            command: "git",
            args: ["clone", "--depth", "1", "--single-branch", repository, vendorPath],
            timeout: testTimeout,
            cwd,
          });
          if (!ok) throw new Error(`failed to git clone vendor '${name}': ${error}`);
        }

        let { ok, error } = await spawnSafe({
          command: "git",
          args: ["fetch", "--depth", "1", "origin", "tag", tag],
          timeout: testTimeout,
          cwd: vendorPath,
        });
        if (!ok) throw new Error(`failed to fetch tag ${tag} for vendor '${name}': ${error}`);

        ({ ok, error } = await spawnSafe({
          command: "git",
          args: ["checkout", tag],
          timeout: testTimeout,
          cwd: vendorPath,
        }));
        if (!ok) throw new Error(`failed to checkout tag ${tag} for vendor '${name}': ${error}`);

        const packageJsonPath = join(vendorPath, "package.json");
        if (!existsSync(packageJsonPath)) {
          throw new Error(`Vendor '${name}' does not have a package.json: ${packageJsonPath}`);
        }

        const testPathPrefix = testPath || "test";
        const testParentPath = join(vendorPath, testPathPrefix);
        if (!existsSync(testParentPath)) {
          throw new Error(`Vendor '${name}' does not have a test directory: ${testParentPath}`);
        }

        const isTest = path => {
          if (!isJavaScriptTest(path)) {
            return false;
          }

          if (typeof skipTests === "boolean") {
            return !skipTests;
          }

          if (typeof skipTests === "object") {
            for (const [glob, reason] of Object.entries(skipTests)) {
              const pattern = new RegExp(`^${glob.replace(/\*/g, ".*")}$`);
              if (pattern.test(path) && reason) {
                return false;
              }
            }
          }

          return true;
        };

        const testPaths = readdirSync(testParentPath, { encoding: "utf-8", recursive: true })
          .filter(filename =>
            testExtensions ? testExtensions.some(ext => filename.endsWith(`.${ext}`)) : isTest(filename),
          )
          .map(filename => join(testPathPrefix, filename))
          .filter(
            filename =>
              !filters?.length ||
              filters.some(filter => join(vendorPath, filename).replace(/\\/g, "/").includes(filter)),
          );

        return {
          cwd: vendorPath,
          packageManager: packageManager || "bun",
          testRunner: testRunner || "bun",
          testPaths,
        };
      },
    ),
  );
}

/**
 * @param {string} cwd
 * @param {string[]} testModifiers
 * @param {TestExpectation[]} testExpectations
 * @returns {string[]}
 */
function getRelevantTests(cwd, testModifiers, testExpectations) {
  let tests = getTests(cwd);
  const availableTests = [];
  const filteredTests = [];

  if (options["node-tests"]) {
    tests = tests.filter(isNodeTest);
  }

  const isMatch = (testPath, filter) => {
    return testPath.replace(/\\/g, "/").includes(filter);
  };

  const getFilter = filter => {
    return (
      filter
        ?.split(",")
        .map(part => part.trim())
        .filter(Boolean) ?? []
    );
  };

  const includes = options["include"]?.flatMap(getFilter);
  if (includes?.length) {
    availableTests.push(...tests.filter(testPath => includes.some(filter => isMatch(testPath, filter))));
    !isQuiet && console.log("Including tests:", includes, availableTests.length, "/", tests.length);
  } else {
    availableTests.push(...tests);
  }

  const excludes = options["exclude"]?.flatMap(getFilter);
  if (excludes?.length) {
    const excludedTests = availableTests.filter(testPath => excludes.some(filter => isMatch(testPath, filter)));
    if (excludedTests.length) {
      for (const testPath of excludedTests) {
        const index = availableTests.indexOf(testPath);
        if (index !== -1) {
          availableTests.splice(index, 1);
        }
      }
      !isQuiet && console.log("Excluding tests:", excludes, excludedTests.length, "/", availableTests.length);
    }
  }

  const skipExpectations = testExpectations
    .filter(
      ({ modifiers, expectations }) =>
        !modifiers?.length || testModifiers.some(modifier => modifiers?.includes(modifier)),
    )
    .map(({ filename }) => filename.replace("test/", ""));
  if (skipExpectations.length) {
    const skippedTests = availableTests.filter(testPath => skipExpectations.some(filter => isMatch(testPath, filter)));
    if (skippedTests.length) {
      for (const testPath of skippedTests) {
        const index = availableTests.indexOf(testPath);
        if (index !== -1) {
          availableTests.splice(index, 1);
        }
      }
      !isQuiet && console.log("Skipping tests:", skipExpectations, skippedTests.length, "/", availableTests.length);
    }
  }

  const shardId = parseInt(options["shard"]);
  const maxShards = parseInt(options["max-shards"]);
  if (filters?.length) {
    filteredTests.push(...availableTests.filter(testPath => filters.some(filter => isMatch(testPath, filter))));
    !isQuiet && console.log("Filtering tests:", filteredTests.length, "/", availableTests.length);
  } else if (options["smoke"] !== undefined) {
    const smokePercent = parseFloat(options["smoke"]) || 0.01;
    const smokeCount = Math.ceil(availableTests.length * smokePercent);
    const smokeTests = new Set();
    for (let i = 0; i < smokeCount; i++) {
      const randomIndex = Math.floor(Math.random() * availableTests.length);
      smokeTests.add(availableTests[randomIndex]);
    }
    filteredTests.push(...Array.from(smokeTests));
    !isQuiet && console.log("Smoking tests:", filteredTests.length, "/", availableTests.length);
  } else if (maxShards > 1) {
    for (let i = 0; i < availableTests.length; i++) {
      if (i % maxShards === shardId) {
        filteredTests.push(availableTests[i]);
      }
    }
    !isQuiet &&
      console.log(
        "Sharding tests:",
        shardId,
        "/",
        maxShards,
        "with tests",
        filteredTests.length,
        "/",
        availableTests.length,
      );
  } else {
    filteredTests.push(...availableTests);
  }

  // Prioritize modified test files
  if (allFiles.length > 0) {
    const modifiedTests = new Set(
      allFiles
        .filter(filename => filename.startsWith("test/") && isTest(filename))
        .map(filename => filename.slice("test/".length)),
    );

    if (modifiedTests.size > 0) {
      return filteredTests
        .map(testPath => testPath.replaceAll("\\", "/"))
        .sort((a, b) => {
          const aModified = modifiedTests.has(a);
          const bModified = modifiedTests.has(b);
          if (aModified && !bModified) return -1;
          if (!aModified && bModified) return 1;
          return 0;
        });
    }
  }

  return filteredTests;
}

/**
 * @param {string} bunExe
 * @returns {string}
 */
function getExecPath(bunExe) {
  let execPath;
  let error;
  try {
    const { error, stdout } = spawnSync(bunExe, ["--print", "process.argv[0]"], {
      encoding: "utf-8",
      timeout: spawnTimeout,
      env: {
        PATH: process.env.PATH,
        BUN_DEBUG_QUIET_LOGS: 1,
      },
    });
    if (error) {
      throw error;
    }
    execPath = stdout.trim();
  } catch (cause) {
    error = cause;
  }

  if (execPath) {
    if (isExecutable(execPath)) {
      return execPath;
    }
    error = new Error(`File is not an executable: ${execPath}`);
  }

  throw new Error(`Could not find executable: ${bunExe}`, { cause: error });
}

/**
 * @param {string} target
 * @param {string} [buildId]
 * @returns {Promise<string>}
 */
async function getExecPathFromBuildKite(target, buildId) {
  if (existsSync(target) || target.includes("/")) {
    return getExecPath(target);
  }

  const releasePath = join(cwd, "release");
  mkdirSync(releasePath, { recursive: true });

  let zipPath;
  downloadLoop: for (let i = 0; i < 10; i++) {
    const args = ["artifact", "download", "**", releasePath, "--step", target];
    if (buildId) {
      args.push("--build", buildId);
    }

    await spawnSafe({
      command: "buildkite-agent",
      args,
      timeout: 60000,
    });

    zipPath = readdirSync(releasePath, { recursive: true, encoding: "utf-8" })
      .filter(filename => /^bun.*\.zip$/i.test(filename))
      .map(filename => join(releasePath, filename))
      .sort((a, b) => b.includes("profile") - a.includes("profile"))
      .at(0);

    if (zipPath) {
      break downloadLoop;
    }

    console.warn(`Waiting for ${target}.zip to be available...`);
    await new Promise(resolve => setTimeout(resolve, i * 1000));
  }

  if (!zipPath) {
    throw new Error(`Could not find ${target}.zip from Buildkite: ${releasePath}`);
  }

  await unzip(zipPath, releasePath);

  const releaseFiles = readdirSync(releasePath, { recursive: true, encoding: "utf-8" });
  for (const entry of releaseFiles) {
    const execPath = join(releasePath, entry);
    if (/bun(?:-[a-z]+)?(?:\.exe)?$/i.test(entry) && statSync(execPath).isFile()) {
      return execPath;
    }
  }

  console.warn(`Found ${releaseFiles.length} files in ${releasePath}:`, releaseFiles);
  throw new Error(`Could not find executable from BuildKite: ${releasePath}`);
}

/**
 * @param {string} execPath
 * @returns {string}
 */
function getRevision(execPath) {
  try {
    const { error, stdout } = spawnSync(execPath, ["--revision"], {
      encoding: "utf-8",
      timeout: spawnTimeout,
      env: {
        PATH: process.env.PATH,
        BUN_DEBUG_QUIET_LOGS: 1,
      },
    });
    if (error) {
      throw error;
    }
    return stdout.trim();
  } catch (error) {
    console.warn(error);
    return "<unknown>";
  }
}

/**
 * @param  {...string} paths
 * @returns {string}
 */
function addPath(...paths) {
  if (isWindows) {
    return paths.join(";");
  }
  return paths.join(":");
}

/**
 * @returns {string | undefined}
 */
function getTestLabel() {
  return getBuildLabel()?.replace(" - test-bun", "");
}

/**
 * @param  {TestResult | TestResult[]} result
 * @param  {boolean} concise
 * @param  {number} retries
 * @returns {string}
 */
function formatTestToMarkdown(result, concise, retries) {
  const results = Array.isArray(result) ? result : [result];
  const buildLabel = getTestLabel();
  const buildUrl = getBuildUrl();
  const platform = buildUrl ? `<a href="${buildUrl}">${buildLabel}</a>` : buildLabel;

  let markdown = "";
  for (const { testPath, ok, tests, error, stdoutPreview: stdout } of results) {
    if (ok || error === "SIGTERM") {
      continue;
    }

    let errorLine;
    for (const { error } of tests) {
      if (!error) {
        continue;
      }
      const { file, line } = error;
      if (line) {
        errorLine = line;
        break;
      }
    }

    const testTitle = testPath.replace(/\\/g, "/");
    const testUrl = getFileUrl(testPath, errorLine);

    if (concise) {
      markdown += "<li>";
    } else {
      markdown += "<details><summary>";
    }

    if (testUrl) {
      markdown += `<a href="${testUrl}"><code>${testTitle}</code></a>`;
    } else {
      markdown += `<a><code>${testTitle}</code></a>`;
    }
    if (error) {
      markdown += ` - ${error}`;
    }
    if (platform) {
      markdown += ` on ${platform}`;
    }
    if (retries > 0) {
      markdown += ` (${retries} ${retries === 1 ? "retry" : "retries"})`;
    }
    if (newFiles.includes(testTitle)) {
      markdown += ` (new)`;
    }

    if (concise) {
      markdown += "</li>\n";
    } else {
      markdown += "</summary>\n\n";
      if (isBuildkite) {
        const preview = escapeCodeBlock(stdout);
        markdown += `\`\`\`terminal\n${preview}\n\`\`\`\n`;
      } else {
        const preview = escapeHtml(stripAnsi(stdout));
        markdown += `<pre><code>${preview}</code></pre>\n`;
      }
      markdown += "\n\n</details>\n\n";
    }
  }

  return markdown;
}

/**
 * @param {string} glob
 */
function uploadArtifactsToBuildKite(glob) {
  spawn("buildkite-agent", ["artifact", "upload", glob], {
    stdio: ["ignore", "ignore", "ignore"],
    timeout: spawnTimeout,
    cwd,
  });
}

/**
 * @param {string} [glob]
 * @param {string} [step]
 */
function listArtifactsFromBuildKite(glob, step) {
  const args = [
    "artifact",
    "search",
    "--no-color",
    "--allow-empty-results",
    "--include-retried-jobs",
    "--format",
    "%p\n",
    glob || "*",
  ];
  if (step) {
    args.push("--step", step);
  }
  const { error, status, signal, stdout, stderr } = spawnSync("buildkite-agent", args, {
    stdio: ["ignore", "ignore", "ignore"],
    encoding: "utf-8",
    timeout: spawnTimeout,
    cwd,
  });
  if (status === 0) {
    return stdout?.split("\n").map(line => line.trim()) || [];
  }
  const cause = error ?? signal ?? `code ${status}`;
  console.warn("Failed to list artifacts from BuildKite:", cause, stderr);
  return [];
}

/**
 * @param {string} name
 * @param {string} value
 */
function reportOutputToGitHubAction(name, value) {
  const outputPath = process.env["GITHUB_OUTPUT"];
  if (!outputPath) {
    return;
  }
  const delimeter = Math.random().toString(36).substring(2, 15);
  const content = `${name}<<${delimeter}\n${value}\n${delimeter}\n`;
  appendFileSync(outputPath, content);
}

/**
 * @param {string} color
 * @returns {string}
 */
function getAnsi(color) {
  switch (color) {
    case "red":
      return "\x1b[31m";
    case "green":
      return "\x1b[32m";
    case "yellow":
      return "\x1b[33m";
    case "blue":
      return "\x1b[34m";
    case "reset":
      return "\x1b[0m";
    case "gray":
      return "\x1b[90m";
    default:
      return "";
  }
}

/**
 * @param {string} string
 * @returns {string}
 */
function stripAnsi(string) {
  return string.replace(/\u001b\[\d+m/g, "");
}

/**
 * @param {string} string
 * @returns {string}
 */
function escapeGitHubAction(string) {
  return string.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/**
 * @param {string} string
 * @returns {string}
 */
function unescapeGitHubAction(string) {
  return string.replace(/%25/g, "%").replace(/%0D/g, "\r").replace(/%0A/g, "\n");
}

/**
 * @param {string} string
 * @returns {string}
 */
function escapeHtml(string) {
  return string
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/`/g, "&#96;");
}

/**
 * @param {string} string
 * @returns {string}
 */
function escapeCodeBlock(string) {
  return string.replace(/`/g, "\\`");
}

/**
 * @param {string} string
 * @returns {number | undefined}
 */
function parseDuration(duration) {
  const match = /(\d+\.\d+)(m?s)/.exec(duration);
  if (!match) {
    return undefined;
  }
  const [, value, unit] = match;
  return parseFloat(value) * (unit === "ms" ? 1 : 1000);
}

/**
 * @param {string} execPath
 * @returns {boolean}
 */
function isExecutable(execPath) {
  if (!existsSync(execPath) || !statSync(execPath).isFile()) {
    return false;
  }
  try {
    accessSync(execPath, fs.X_OK);
  } catch {
    return false;
  }
  return true;
}

/**
 * @param {"pass" | "fail" | "cancel"} [outcome]
 */
function getExitCode(outcome) {
  if (outcome === "pass") {
    return 0;
  }
  if (!isBuildkite) {
    return 1;
  }
  // On Buildkite, you can define a `soft_fail` property to differentiate
  // from failing tests and the runner itself failing.
  if (outcome === "fail") {
    return 2;
  }
  if (outcome === "cancel") {
    return 3;
  }
  return 1;
}

// A flaky segfault, sigtrap, or sigkill must never be ignored.
// If it happens in CI, it will happen to our users.
// Flaky AddressSanitizer errors cannot be ignored since they still represent real bugs.
function isAlwaysFailure(error) {
  error = ((error || "") + "").toLowerCase().trim();
  return (
    error.includes("segmentation fault") ||
    error.includes("illegal instruction") ||
    error.includes("sigtrap") ||
    error.includes("sigkill") ||
    error.includes("error: addresssanitizer") ||
    error.includes("internal assertion failure") ||
    error.includes("core dumped") ||
    error.includes("crash reported")
  );
}

/**
 * @param {string} signal
 */
function onExit(signal) {
  const label = `${getAnsi("red")}Received ${signal}, exiting...${getAnsi("reset")}`;
  startGroup(label, () => {
    process.exit(getExitCode("cancel"));
  });
}

let getBuildkiteAnalyticsToken = () => {
  let token = getSecret("TEST_REPORTING_API", { required: true });
  getBuildkiteAnalyticsToken = () => token;
  return token;
};

/**
 * Generate a JUnit XML report from test results
 * @param {string} outfile - The path to write the JUnit XML report to
 * @param {TestResult[]} results - The test results to include in the report
 */
function generateJUnitReport(outfile, results) {
  !isQuiet && console.log(`Generating JUnit XML report: ${outfile}`);

  // Start the XML document
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';

  // Add an overall testsuite container with metadata
  const totalTests = results.length;
  const totalFailures = results.filter(r => r.status === "fail").length;
  const timestamp = new Date().toISOString();

  // Calculate total time
  const totalTime = results.reduce((sum, result) => {
    const duration = result.duration || 0;
    return sum + duration / 1000; // Convert ms to seconds
  }, 0);

  // Create a unique package name to identify this run
  const packageName = `bun.internal.${process.env.BUILDKITE_PIPELINE_SLUG || "tests"}`;

  xml += `<testsuites name="${escapeXml(packageName)}" tests="${totalTests}" failures="${totalFailures}" time="${totalTime.toFixed(3)}" timestamp="${timestamp}">\n`;

  // Group results by test file
  const testSuites = new Map();

  for (const result of results) {
    const { testPath, ok, status, error, tests, stdoutPreview, stdout, duration = 0 } = result;

    if (!testSuites.has(testPath)) {
      testSuites.set(testPath, {
        name: testPath,
        tests: [],
        failures: 0,
        errors: 0,
        skipped: 0,
        time: 0,
        timestamp: timestamp,
        hostname: getHostname(),
        stdout: stdout || stdoutPreview || "",
      });
    }

    const suite = testSuites.get(testPath);

    // For test suites with granular test information
    if (tests.length > 0) {
      for (const test of tests) {
        const { test: testName, status: testStatus, duration: testDuration = 0, errors: testErrors = [] } = test;

        suite.time += testDuration / 1000; // Convert to seconds

        const testCase = {
          name: testName,
          classname: `${packageName}.${testPath.replace(/[\/\\]/g, ".")}`,
          time: testDuration / 1000, // Convert to seconds
        };

        if (testStatus === "fail") {
          suite.failures++;

          // Collect error details
          let errorMessage = "Test failed";
          let errorType = "AssertionError";
          let errorContent = "";

          if (testErrors && testErrors.length > 0) {
            const primaryError = testErrors[0];
            errorMessage = primaryError.name || "Test failed";
            errorType = primaryError.name || "AssertionError";
            errorContent = primaryError.stack || primaryError.name;

            if (testErrors.length > 1) {
              errorContent +=
                "\n\nAdditional errors:\n" +
                testErrors
                  .slice(1)
                  .map(e => e.stack || e.name)
                  .join("\n");
            }
          } else {
            errorContent = error || "Unknown error";
          }

          testCase.failure = {
            message: errorMessage,
            type: errorType,
            content: errorContent,
          };
        } else if (testStatus === "skip" || testStatus === "todo") {
          suite.skipped++;
          testCase.skipped = {
            message: testStatus === "skip" ? "Test skipped" : "Test marked as todo",
          };
        }

        suite.tests.push(testCase);
      }
    } else {
      // For test suites without granular test information (e.g., bun install tests)
      suite.time += duration / 1000; // Convert to seconds

      const testCase = {
        name: basename(testPath),
        classname: `${packageName}.${testPath.replace(/[\/\\]/g, ".")}`,
        time: duration / 1000, // Convert to seconds
      };

      if (status === "fail") {
        suite.failures++;
        testCase.failure = {
          message: "Test failed",
          type: "AssertionError",
          content: error || "Unknown error",
        };
      }

      suite.tests.push(testCase);
    }
  }

  // Write each test suite to the XML
  for (const [name, suite] of testSuites) {
    xml += `  <testsuite name="${escapeXml(name)}" tests="${suite.tests.length}" failures="${suite.failures}" errors="${suite.errors}" skipped="${suite.skipped}" time="${suite.time.toFixed(3)}" timestamp="${suite.timestamp}" hostname="${escapeXml(suite.hostname)}">\n`;

    // Include system-out if we have stdout
    if (suite.stdout) {
      xml += `    <system-out><![CDATA[${suite.stdout}]]></system-out>\n`;
    }

    // Write each test case
    for (const test of suite.tests) {
      xml += `    <testcase name="${escapeXml(test.name)}" classname="${escapeXml(test.classname)}" time="${test.time.toFixed(3)}"`;

      if (test.skipped) {
        xml += `>\n      <skipped message="${escapeXml(test.skipped.message)}"/>\n    </testcase>\n`;
      } else if (test.failure) {
        xml += `>\n`;
        xml += `      <failure message="${escapeXml(test.failure.message)}" type="${escapeXml(test.failure.type)}"><![CDATA[${test.failure.content}]]></failure>\n`;
        xml += `    </testcase>\n`;
      } else {
        xml += `/>\n`;
      }
    }

    xml += `  </testsuite>\n`;
  }

  xml += `</testsuites>`;

  // Create directory if it doesn't exist
  const dir = dirname(outfile);
  mkdirSync(dir, { recursive: true });

  // Write to file
  writeFileSync(outfile, xml);
  !isQuiet && console.log(`JUnit XML report written to ${outfile}`);
}

let isUploadingToBuildKite = false;
const junitUploadQueue = [];
async function addToJunitUploadQueue(junitFilePath) {
  junitUploadQueue.push(junitFilePath);

  if (!isUploadingToBuildKite) {
    drainJunitUploadQueue();
  }
}

async function drainJunitUploadQueue() {
  isUploadingToBuildKite = true;
  while (junitUploadQueue.length > 0) {
    const testPath = junitUploadQueue.shift();
    await uploadJUnitToBuildKite(testPath)
      .then(uploadSuccess => {
        unlink(testPath, () => {
          if (!uploadSuccess) {
            console.error(`Failed to upload JUnit report for ${testPath}`);
          }
        });
      })
      .catch(err => {
        console.error(`Error uploading JUnit report for ${testPath}:`, err);
      });
  }
  isUploadingToBuildKite = false;
}

/**
 * Upload JUnit XML report to BuildKite Test Analytics
 * @param {string} junitFile - Path to the JUnit XML file to upload
 * @returns {Promise<boolean>} - Whether the upload was successful
 */
async function uploadJUnitToBuildKite(junitFile) {
  const fileName = basename(junitFile);
  !isQuiet && console.log(`Uploading JUnit file "${fileName}" to BuildKite Test Analytics...`);

  // Get BuildKite environment variables for run_env fields
  const buildId = getEnv("BUILDKITE_BUILD_ID", false);
  const buildUrl = getEnv("BUILDKITE_BUILD_URL", false);
  const branch = getBranch();
  const commit = getCommit();
  const buildNumber = getEnv("BUILDKITE_BUILD_NUMBER", false);
  const jobId = getEnv("BUILDKITE_JOB_ID", false);
  const message = getEnv("BUILDKITE_MESSAGE", false);

  try {
    // Add a unique test suite identifier to help with correlation in BuildKite
    const testId = fileName.replace(/\.xml$/, "");

    // Use fetch and FormData instead of curl
    const formData = new FormData();

    // Add the JUnit file data
    formData.append("data", new Blob([await readFile(junitFile)]), fileName);
    formData.append("format", "junit");
    formData.append("run_env[CI]", "buildkite");

    // Add additional fields
    if (buildId) formData.append("run_env[key]", buildId);
    if (buildUrl) formData.append("run_env[url]", buildUrl);
    if (branch) formData.append("run_env[branch]", branch);
    if (commit) formData.append("run_env[commit_sha]", commit);
    if (buildNumber) formData.append("run_env[number]", buildNumber);
    if (jobId) formData.append("run_env[job_id]", jobId);
    if (message) formData.append("run_env[message]", message);

    // Add custom tags
    formData.append("tags[runtime]", "bun");
    formData.append("tags[suite]", testId);

    // Add additional context information specific to this run
    formData.append("run_env[source]", "junit-import");
    formData.append("run_env[collector]", "bun-runner");

    const url = "https://analytics-api.buildkite.com/v1/uploads";
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Token token="${getBuildkiteAnalyticsToken()}"`,
      },
      body: formData,
    });

    if (response.ok) {
      !isQuiet && console.log(`JUnit file "${fileName}" successfully uploaded to BuildKite Test Analytics`);

      try {
        // Consume the body to ensure Node releases the memory.
        await response.arrayBuffer();
      } catch (error) {
        // Don't care if this fails.
      }

      return true;
    } else {
      const errorText = await response.text();
      console.error(`Failed to upload JUnit file "${fileName}": HTTP ${response.status}`, errorText);
      return false;
    }
  } catch (error) {
    console.error(`Error uploading JUnit file "${fileName}":`, error);
    return false;
  }
}

/**
 * Escape XML special characters
 * @param {string} str - String to escape
 * @returns {string} - Escaped string
 */
function escapeXml(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function main() {
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => onExit(signal));
  }

  if (!isQuiet) {
    printEnvironment();
  }

  // FIXME: Some DNS tests hang unless we set the DNS server to 8.8.8.8
  // It also appears to hang on 1.1.1.1, which could explain this issue:
  // https://github.com/oven-sh/bun/issues/11136
  if (isWindows && isCI) {
    await spawn("pwsh", [
      "-Command",
      "Set-DnsClientServerAddress -InterfaceAlias 'Ethernet 4' -ServerAddresses ('8.8.8.8','8.8.4.4')",
    ]);
  }

  let doRunTests = true;
  if (isCI) {
    if (allFiles.every(filename => filename.startsWith("docs/"))) {
      doRunTests = false;
    }
  }

  let ok = true;
  if (doRunTests) {
    const results = await runTests();
    ok = results.every(({ ok }) => ok);
  }

  let waitForUser = false;
  while (isCI) {
    const userCount = getLoggedInUserCountOrDetails();
    if (!userCount) {
      if (waitForUser) {
        !isQuiet && console.log("No users logged in, exiting runner...");
      }
      break;
    }

    if (!waitForUser) {
      startGroup("Summary");
      if (typeof userCount === "number") {
        console.warn(`Found ${userCount} users logged in, keeping the runner alive until logout...`);
      } else {
        console.warn(userCount);
      }
      waitForUser = true;
    }

    await new Promise(resolve => setTimeout(resolve, 60_000));
  }

  process.exit(getExitCode(ok ? "pass" : "fail"));
}

await main();
