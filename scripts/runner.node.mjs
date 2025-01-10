#! /usr/bin/env node

// This is a script that runs `bun test` to test Bun itself.
// It is not intended to be used as a test runner for other projects.
//
// - It runs each `bun test` in a separate process, to catch crashes.
// - It cannot use Bun APIs, since it is run using Node.js.
// - It does not import dependencies, so it's faster to start.

import {
  constants as fs,
  readFileSync,
  mkdtempSync,
  existsSync,
  statSync,
  mkdirSync,
  accessSync,
  appendFileSync,
  readdirSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { join, basename, dirname, relative, sep } from "node:path";
import { parseArgs } from "node:util";
import {
  getBuildLabel,
  getBuildUrl,
  getEnv,
  getFileUrl,
  getLoggedInUserCountOrDetails,
  getShell,
  getWindowsExitReason,
  isBuildkite,
  isCI,
  isGithubAction,
  isMacOS,
  isWindows,
  isX64,
  printEnvironment,
  startGroup,
  tmpdir,
  unzip,
} from "./utils.mjs";
import { userInfo } from "node:os";
let isQuiet = false;
const cwd = import.meta.dirname ? dirname(import.meta.dirname) : process.cwd();
const testsPath = join(cwd, "test");

const spawnTimeout = 5_000;
const testTimeout = 3 * 60_000;
const integrationTimeout = 5 * 60_000;

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
  },
});

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

      if (attempt >= maxAttempts) {
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
      if (isNodeParallelTest(testPath)) {
        const subcommand = title.includes("needs-test") ? "test" : "run";
        await runTest(title, async () => {
          const { ok, error, stdout } = await spawnBun(execPath, {
            cwd: cwd,
            args: [subcommand, "--config=./bunfig.node-test.toml", absoluteTestPath],
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
  const { ok, error, stdout } = await spawnBun(execPath, {
    args: isReallyTest ? ["test", ...args, `--timeout=${perTestTimeout}`, absPath] : [...args, absPath],
    cwd: options["cwd"],
    timeout: isReallyTest ? timeout : 30_000,
    env: {
      GITHUB_ACTIONS: "true", // always true so annotations are parsed
    },
    stdout: chunk => pipeTestStdout(process.stdout, chunk),
    stderr: chunk => pipeTestStdout(process.stderr, chunk),
  });
  const { tests, errors, stdout: stdoutPreview } = parseTestStdout(stdout, testPath);
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
 * @param {string} testPath
 * @returns {boolean}
 */
function isNodeParallelTest(testPath) {
  return testPath.replaceAll(sep, "/").includes("js/node/test/parallel/");
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function isTest(path) {
  if (isNodeParallelTest(path) && targetDoesRunNodeTests()) return true;
  if (path.replaceAll(sep, "/").startsWith("js/node/cluster/test-") && path.endsWith(".ts")) return true;
  return isTestStrict(path);
}

function isTestStrict(path) {
  return isJavaScript(path) && /\.test|spec\./.test(basename(path));
}

function targetDoesRunNodeTests() {
  if (isMacOS && isX64) return false;
  return true;
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
    tests = tests.filter(isNodeParallelTest);
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
    markdown += ` on ${platform}`;

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
 * @typedef {object} BuildkiteAnnotation
 * @property {string} [context]
 * @property {string} label
 * @property {string} content
 * @property {"error" | "warning" | "info"} [style]
 * @property {number} [priority]
 * @property {number} [attempt]
 */

/**
 * @param {BuildkiteAnnotation} annotation
 */
function reportAnnotationToBuildKite({ context, label, content, style = "error", priority = 3, attempt = 0 }) {
  const { error, status, signal, stderr } = spawnSync(
    "buildkite-agent",
    ["annotate", "--append", "--style", `${style}`, "--context", `${context || label}`, "--priority", `${priority}`],
    {
      input: content,
      stdio: ["pipe", "ignore", "pipe"],
      encoding: "utf-8",
      timeout: spawnTimeout,
      cwd,
    },
  );
  if (status === 0) {
    return;
  }
  if (attempt > 0) {
    const cause = error ?? signal ?? `code ${status}`;
    throw new Error(`Failed to create annotation: ${label}`, { cause });
  }
  const buildLabel = getTestLabel();
  const buildUrl = getBuildUrl();
  const platform = buildUrl ? `<a href="${buildUrl}">${buildLabel}</a>` : buildLabel;
  let errorMessage = `<details><summary><code>${label}</code> - annotation error on ${platform}</summary>`;
  if (stderr) {
    errorMessage += `\n\n\`\`\`terminal\n${escapeCodeBlock(stderr)}\n\`\`\`\n\n</details>\n\n`;
  }
  reportAnnotationToBuildKite({ label: `${label}-error`, content: errorMessage, attempt: attempt + 1 });
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

/**
 * @param {string} signal
 */
function onExit(signal) {
  const label = `${getAnsi("red")}Received ${signal}, exiting...${getAnsi("reset")}`;
  startGroup(label, () => {
    process.exit(getExitCode("cancel"));
  });
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
