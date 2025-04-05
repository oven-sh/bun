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
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  unlink,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { basename, dirname, join, relative, sep } from "node:path";
import { parseArgs } from "node:util";
import {
  getBranch,
  getBuildLabel,
  getBuildUrl,
  getCommit,
  getEnv,
  getFileUrl,
  getHostname,
  getLoggedInUserCountOrDetails,
  getSecret,
  getShell,
  getWindowsExitReason,
  isBuildkite,
  isCI,
  isGithubAction,
  isMacOS,
  isWindows,
  isX64,
  printEnvironment,
  reportAnnotationToBuildKite,
  startGroup,
  tmpdir,
  unzip,
} from "./utils.mjs";
let isQuiet = false;
const cwd = import.meta.dirname ? dirname(import.meta.dirname) : process.cwd();
const testsPath = join(cwd, "test");

const spawnTimeout = 5_000;
const testTimeout = 3 * 60_000;
const integrationTimeout = 5 * 60_000;
const napiTimeout = 10 * 60_000;

function getNodeParallelTestTimeout(testPath) {
  if (testPath.includes("test-dns")) {
    return 90_000;
  }
  return 10_000;
}

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
      default: isCI ? "4" : "0", // N retries = N+1 attempts
    },
    ["junit"]: {
      type: "boolean",
      default: isCI, // Always enable JUnit in CI
    },
    ["junit-temp-dir"]: {
      type: "string",
      default: "junit-reports",
    },
    ["junit-upload"]: {
      type: "boolean",
      default: isBuildkite,
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

/**
 *
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

  const revision = getRevision(execPath);
  !isQuiet && console.log("Revision:", revision);

  const tests = getRelevantTests(testsPath);
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
  const failedResults = [];
  const maxAttempts = 1 + (parseInt(options["retries"]) || 0);

  /**
   * @param {string} title
   * @param {function} fn
   * @returns {Promise<TestResult>}
   */
  const runTest = async (title, fn) => {
    const index = ++i;

    let result, failure, flaky;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        await new Promise(resolve => setTimeout(resolve, 5000 + Math.random() * 10_000));
      }

      result = await startGroup(
        attempt === 1
          ? `${getAnsi("gray")}[${index}/${total}]${getAnsi("reset")} ${title}`
          : `${getAnsi("gray")}[${index}/${total}]${getAnsi("reset")} ${title} ${getAnsi("gray")}[attempt #${attempt}]${getAnsi("reset")}`,
        fn,
      );

      const { ok, stdoutPreview, error } = result;
      if (ok) {
        if (failure) {
          flakyResults.push(failure);
        } else {
          okResults.push(result);
        }
        break;
      }

      const color = attempt >= maxAttempts ? "red" : "yellow";
      const label = `${getAnsi(color)}[${index}/${total}] ${title} - ${error}${getAnsi("reset")}`;
      startGroup(label, () => {
        process.stderr.write(stdoutPreview);
      });

      failure ||= result;
      flaky ||= true;

      if (attempt >= maxAttempts || isAlwaysFailure(error)) {
        flaky = false;
        failedResults.push(failure);
      }
    }

    if (!failure) {
      return result;
    }

    if (isBuildkite) {
      // Group flaky tests together, regardless of the title
      const context = flaky ? "flaky" : title;
      const style = flaky || title.startsWith("vendor") ? "warning" : "error";

      if (title.startsWith("vendor")) {
        const content = formatTestToMarkdown({ ...failure, testPath: title });
        if (content) {
          reportAnnotationToBuildKite({ context, label: title, content, style });
        }
      } else {
        const content = formatTestToMarkdown(failure);
        if (content) {
          reportAnnotationToBuildKite({ context, label: title, content, style });
        }
      }
    }

    if (isGithubAction) {
      const summaryPath = process.env["GITHUB_STEP_SUMMARY"];
      if (summaryPath) {
        const longMarkdown = formatTestToMarkdown(failure);
        appendFileSync(summaryPath, longMarkdown);
      }
      const shortMarkdown = formatTestToMarkdown(failure, true);
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
    for (const testPath of tests) {
      const absoluteTestPath = join(testsPath, testPath);
      const title = relative(cwd, absoluteTestPath).replaceAll(sep, "/");
      if (isNodeTest(testPath)) {
        const testContent = readFileSync(absoluteTestPath, "utf-8");
        const runWithBunTest =
          title.includes("needs-test") || testContent.includes("bun:test") || testContent.includes("node:test");
        const subcommand = runWithBunTest ? "test" : "run";
        await runTest(title, async () => {
          const { ok, error, stdout } = await spawnBun(execPath, {
            cwd: cwd,
            args: [subcommand, "--config=" + join(import.meta.dirname, "../bunfig.node-test.toml"), absoluteTestPath],
            timeout: getNodeParallelTestTimeout(title),
            env: {
              FORCE_COLOR: "0",
              NO_COLOR: "1",
              BUN_DEBUG_QUIET_LOGS: "1",
            },
            stdout: chunk => pipeTestStdout(process.stdout, chunk),
            stderr: chunk => pipeTestStdout(process.stderr, chunk),
          });
          const mb = 1024 ** 3;
          const stdoutPreview = stdout.slice(0, mb).split("\n").slice(0, 50).join("\n");
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
        await runTest(title, async () => spawnBunTest(execPath, join("test", testPath)));
      }
    }
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

      for (const testPath of testPaths) {
        const title = join(relative(cwd, vendorPath), testPath).replace(/\\/g, "/");

        if (testRunner === "bun") {
          await runTest(title, () => spawnBunTest(execPath, testPath, { cwd: vendorPath }));
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

  if (isGithubAction) {
    reportOutputToGitHubAction("failing_tests_count", failedResults.length);
    const markdown = formatTestToMarkdown(failedResults);
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

  if (!isCI && !isQuiet) {
    console.table({
      "Total Tests": okResults.length + failedResults.length + flakyResults.length,
      "Passed Tests": okResults.length,
      "Failing Tests": failedResults.length,
      "Flaky Tests": flakyResults.length,
    });

    if (failedResults.length) {
      console.log(`${getAnsi("red")}Failing Tests:${getAnsi("reset")}`);
      for (const { testPath } of failedResults) {
        console.log(`${getAnsi("red")}- ${testPath}${getAnsi("reset")}`);
      }
    }

    if (flakyResults.length) {
      console.log(`${getAnsi("yellow")}Flaky Tests:${getAnsi("reset")}`);
      for (const { testPath } of flakyResults) {
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
    (error = /oh no: Bun has crashed/i.exec(buffer))
  ) {
    const [, message] = error || [];
    error = message ? message.split("\n")[0].toLowerCase() : "crash";
    error = error.indexOf("\\n") !== -1 ? error.substring(0, error.indexOf("\\n")) : error;
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
  };
}

/**
 * @param {string} execPath Path to bun binary
 * @param {SpawnOptions} options
 * @returns {Promise<SpawnResult>}
 */
async function spawnBun(execPath, { args, cwd, timeout, env, stdout, stderr }) {
  const path = addPath(dirname(execPath), process.env.PATH);
  const tmpdirPath = mkdtempSync(join(tmpdir(), "buntmp-"));
  const { username, homedir } = userInfo();
  const shellPath = getShell();
  const bunEnv = {
    ...process.env,
    PATH: path,
    TMPDIR: tmpdirPath,
    USER: username,
    HOME: homedir,
    SHELL: shellPath,
    FORCE_COLOR: "1",
    BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1",
    BUN_DEBUG_QUIET_LOGS: "1",
    BUN_GARBAGE_COLLECTOR_LEVEL: "1",
    BUN_JSC_randomIntegrityAuditRate: "1.0",
    BUN_ENABLE_CRASH_REPORTING: "0", // change this to '1' if https://github.com/oven-sh/bun/issues/13012 is implemented
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
    BUN_INSTALL_CACHE_DIR: tmpdirPath,
    SHELLOPTS: isWindows ? "igncr" : undefined, // ignore "\r" on Windows
    // Used in Node.js tests.
    TEST_TMPDIR: tmpdirPath,
  };

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
  try {
    return await spawnSafe({
      command: execPath,
      args,
      cwd,
      timeout,
      env: bunEnv,
      stdout,
      stderr,
    });
  } finally {
    // try {
    //   rmSync(tmpdirPath, { recursive: true, force: true });
    // } catch (error) {
    //   console.warn(error);
    // }
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
 * @param {object} [options]
 * @param {string} [options.cwd]
 * @param {string[]} [options.args]
 * @returns {Promise<TestResult>}
 */
async function spawnBunTest(execPath, testPath, options = { cwd }) {
  const timeout = getTestTimeout(testPath);
  const perTestTimeout = Math.ceil(timeout / 2);
  const absPath = join(options["cwd"], testPath);
  const isReallyTest = isTestStrict(testPath) || absPath.includes("vendor");
  const args = options["args"] ?? [];

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

  const { ok, error, stdout } = await spawnBun(execPath, {
    args: isReallyTest ? testArgs : [...args, absPath],
    cwd: options["cwd"],
    timeout: isReallyTest ? timeout : 30_000,
    env: {
      GITHUB_ACTIONS: "true", // always true so annotations are parsed
    },
    stdout: chunk => pipeTestStdout(process.stdout, chunk),
    stderr: chunk => pipeTestStdout(process.stderr, chunk),
  });
  const { tests, errors, stdout: stdoutPreview } = parseTestStdout(stdout, testPath);

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
  if (/napi/i.test(testPath)) {
    return napiTimeout;
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
  const { ok, error, stdout, duration } = await spawnBun(execPath, {
    args: ["install"],
    timeout: testTimeout,
    ...options,
  });
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
  // Do not run node tests on macOS x64 in CI
  // TODO: Unclear why we decided to do this?
  if (isCI && isMacOS && isX64) {
    return false;
  }
  const unixPath = path.replaceAll(sep, "/");
  return unixPath.includes("js/node/test/parallel/") || unixPath.includes("js/node/test/sequential/");
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

/** Files with these extensions are not treated as test cases */
const IGNORED_EXTENSIONS = new Set([".md"]);

/**
 * @param {string} cwd
 * @returns {string[]}
 */
function getTests(cwd) {
  function* getFiles(cwd, path) {
    const dirname = join(cwd, path);
    for (const entry of readdirSync(dirname, { encoding: "utf-8", withFileTypes: true })) {
      const { name } = entry;
      const ext = name.slice(name.lastIndexOf("."));
      const filename = join(path, name);
      if (isHidden(filename) || IGNORED_EXTENSIONS.has(ext)) {
        continue;
      }
      if (entry.isFile() && isTest(filename)) {
        yield filename;
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
          await spawnSafe({
            command: "git",
            args: ["clone", "--depth", "1", "--single-branch", repository, vendorPath],
            timeout: testTimeout,
            cwd,
          });
        }

        await spawnSafe({
          command: "git",
          args: ["fetch", "--depth", "1", "origin", "tag", tag],
          timeout: testTimeout,
          cwd: vendorPath,
        });

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
 * @returns {string[]}
 */
function getRelevantTests(cwd) {
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
    });

    for (const entry of readdirSync(releasePath, { recursive: true, encoding: "utf-8" })) {
      if (/^bun.*\.zip$/i.test(entry) && !entry.includes("-profile.zip")) {
        zipPath = join(releasePath, entry);
        break downloadLoop;
      }
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
    if (/bun(?:\.exe)?$/i.test(entry) && statSync(execPath).isFile()) {
      return execPath;
    }
  }

  console.warn(`Found ${releaseFiles.length} files in ${releasePath}:`);
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
 * @returns {string}
 */
function formatTestToMarkdown(result, concise) {
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

// A flaky segfault, sigtrap, or sigill must never be ignored.
// If it happens in CI, it will happen to our users.
function isAlwaysFailure(error) {
  error = ((error || "") + "").toLowerCase().trim();
  return error.includes("segmentation fault") || error.includes("sigill") || error.includes("sigtrap");
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

  const results = await runTests();
  const ok = results.every(({ ok }) => ok);

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
