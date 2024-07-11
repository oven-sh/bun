import * as action from "@actions/core";
import { spawn, spawnSync } from "child_process";
import { rmSync, writeFileSync, readFileSync, mkdirSync, openSync, closeSync } from "fs";
import { readdirSync } from "node:fs";
import { resolve, basename } from "node:path";
import { cpus, hostname, tmpdir, totalmem, userInfo } from "os";
import { join, normalize, posix, relative } from "path";
import { fileURLToPath } from "url";
import PQueue from "p-queue";

const run_start = new Date();
const TIMEOUT_DURATION = 1000 * 60 * 5;
const SHORT_TIMEOUT_DURATION = Math.ceil(TIMEOUT_DURATION / 5);

function defaultConcurrency() {
  // This causes instability due to the number of open file descriptors / sockets in some tests
  // Windows has higher limits
  if (process.platform !== "win32") {
    return 1;
  }

  return Math.min(Math.floor((cpus().length - 2) / 2), 2);
}
const windows = process.platform === "win32";
const nativeMemory = totalmem();
const force_ram_size_input = parseInt(process.env["BUN_JSC_forceRAMSize"] || "0", 10);
let force_ram_size = Number(BigInt(nativeMemory) >> BigInt(2)) + "";
if (!(Number.isSafeInteger(force_ram_size_input) && force_ram_size_input > 0)) {
  force_ram_size = force_ram_size_input + "";
}
function uncygwinTempDir() {
  if (process.platform === "win32") {
    for (let key of ["TMPDIR", "TEMP", "TEMPDIR", "TMP"]) {
      let TMPDIR = process.env[key] || "";
      if (!/^\/[a-zA-Z]\//.test(TMPDIR)) {
        continue;
      }

      const driveLetter = TMPDIR[1];
      TMPDIR = path.win32.normalize(`${driveLetter.toUpperCase()}:` + TMPDIR.substring(2));
      process.env[key] = TMPDIR;
    }
  }
}

uncygwinTempDir();

const cwd = resolve(fileURLToPath(import.meta.url), "../../../../");
process.chdir(cwd);

const ci = !!process.env["GITHUB_ACTIONS"];
const enableProgressBar = false;

const dirPrefix = "bun-test-tmp-" + ((Math.random() * 100_000_0) | 0).toString(36) + "_";
const run_concurrency = Math.max(Number(process.env["BUN_TEST_CONCURRENCY"] || defaultConcurrency(), 10), 1);
const queue = new PQueue({ concurrency: run_concurrency });

var prevTmpdir = "";
function maketemp() {
  prevTmpdir = join(
    tmpdir(),
    dirPrefix + (Date.now() | 0).toString() + "_" + ((Math.random() * 100_000_0) | 0).toString(36),
  );
  mkdirSync(prevTmpdir, { recursive: true });
  return prevTmpdir;
}

const extensions = [".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs", ".mts", ".cts", ".mjsx", ".cjsx", ".mtsx", ".ctsx"];

const git_sha =
  process.env["GITHUB_SHA"] ?? spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).stdout.trim();

const TEST_FILTER = process.env.BUN_TEST_FILTER;

function isTest(path) {
  if (!basename(path).includes(".test.") || !extensions.some(ext => path.endsWith(ext))) {
    return false;
  }

  if (TEST_FILTER) {
    if (!path.includes(TEST_FILTER)) {
      return false;
    }
  }

  return true;
}

function* findTests(dir, query) {
  for (const entry of readdirSync(resolve(dir), { encoding: "utf-8", withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git") {
      yield* findTests(path, query);
    } else if (isTest(path)) {
      yield path;
    }
  }
}

let bunExe = "bun";

if (process.argv.length > 2) {
  bunExe = resolve(process.argv.at(-1));
} else if (process.env.BUN_PATH) {
  const { BUN_PATH_BASE, BUN_PATH } = process.env;
  bunExe = resolve(normalize(BUN_PATH_BASE), normalize(BUN_PATH));
}

const { error, stdout: revision_stdout } = spawnSync(bunExe, ["--revision"], {
  env: { ...process.env, BUN_DEBUG_QUIET_LOGS: 1 },
});
if (error) {
  if (error.code !== "ENOENT") throw error;
  console.error(`\x1b[31merror\x1b[0;2m:\x1b[0m Could not find Bun executable at '${bunExe}'`);
  process.exit(1);
}
const revision = revision_stdout.toString().trim();

const { error: error2, stdout: argv0_stdout } = spawnSync(bunExe, ["-e", "console.log(process.argv[0])"], {
  env: { ...process.env, BUN_DEBUG_QUIET_LOGS: 1 },
});
if (error2) throw error2;
const argv0 = argv0_stdout.toString().trim();

console.log(`Testing ${argv0} v${revision}`);

const ntStatusPath = "C:\\Program Files (x86)\\Windows Kits\\10\\Include\\10.0.22621.0\\shared\\ntstatus.h";
let ntstatus_header_cache = null;
function lookupWindowsError(code) {
  if (ntstatus_header_cache === null) {
    try {
      ntstatus_header_cache = readFileSync(ntStatusPath, "utf-8");
    } catch {
      console.error(`could not find ntstatus.h to lookup error code: ${ntStatusPath}`);
      ntstatus_header_cache = "";
    }
  }
  const match = ntstatus_header_cache.match(new RegExp(`(STATUS_\\w+).*0x${code.toString(16)}`, "i"));
  if (match) {
    return match[1];
  }
  return null;
}

const failing_tests = [];
const passing_tests = [];
let maxFd = -1;
function getMaxFileDescriptor(path) {
  if (process.platform === "win32") {
    return -1;
  }

  hasInitialMaxFD = true;

  if (process.platform === "linux" || process.platform === "darwin") {
    try {
      readdirSync(process.platform === "darwin" ? "/dev/fd" : "/proc/self/fd").forEach(name => {
        const fd = parseInt(name.trim(), 10);
        if (Number.isSafeInteger(fd) && fd >= 0) {
          maxFd = Math.max(maxFd, fd);
        }
      });

      return maxFd;
    } catch {}
  }

  const devnullfd = openSync("/dev/null", "r");
  closeSync(devnullfd);
  maxFd = devnullfd + 1;
  return maxFd;
}
let hasInitialMaxFD = false;

const activeTests = new Map();

let slowTestCount = 0;
function checkSlowTests() {
  const now = Date.now();
  const prevSlowTestCount = slowTestCount;
  slowTestCount = 0;
  for (const [path, { start, proc }] of activeTests) {
    if (proc && now - start >= TIMEOUT_DURATION) {
      console.error(
        `\x1b[31merror\x1b[0;2m:\x1b[0m Killing test ${JSON.stringify(path)} after ${Math.ceil((now - start) / 1000)}s`,
      );
      proc?.stdout?.destroy?.();
      proc?.stderr?.destroy?.();
      proc?.kill?.(9);
    } else if (now - start > SHORT_TIMEOUT_DURATION) {
      console.error(
        `\x1b[33mwarning\x1b[0;2m:\x1b[0m Test ${JSON.stringify(path)} has been running for ${Math.ceil(
          (now - start) / 1000,
        )}s`,
      );
      slowTestCount++;
    }
  }

  if (slowTestCount > prevSlowTestCount && queue.concurrency > 1) {
    queue.concurrency += 1;
  }
}

setInterval(checkSlowTests, SHORT_TIMEOUT_DURATION).unref();
var currentTestNumber = 0;
async function runTest(path) {
  const pathOnDisk = resolve(path);
  const thisTestNumber = currentTestNumber++;
  const testFileName = posix.normalize(relative(cwd, path).replaceAll("\\", "/"));
  let exitCode, signal, err, output;

  const start = Date.now();

  const activeTestObject = { start, proc: undefined };
  activeTests.set(testFileName, activeTestObject);

  try {
    await new Promise((finish, reject) => {
      const chunks = [];
      process.stderr.write(
        `
at ${((start - run_start.getTime()) / 1000).toFixed(2)}s, file ${thisTestNumber
          .toString()
          .padStart(total.toString().length, "0")}/${total}, ${failing_tests.length} failing files
Starting "${testFileName}"

`,
      );
      const TMPDIR = maketemp();
      const proc = spawn(bunExe, ["test", pathOnDisk], {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          FORCE_COLOR: "1",
          BUN_GARBAGE_COLLECTOR_LEVEL: "1",
          BUN_JSC_forceRAMSize: force_ram_size,
          BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
          GITHUB_ACTIONS: process.env.GITHUB_ACTIONS ?? "true",
          BUN_DEBUG_QUIET_LOGS: "1",
          BUN_INSTALL_CACHE_DIR: join(TMPDIR, ".bun-install-cache"),
          BUN_ENABLE_CRASH_REPORTING: "1",
          [windows ? "TEMP" : "TMPDIR"]: TMPDIR,
        },
      });
      activeTestObject.proc = proc;
      proc.stdout.once("end", () => {
        done();
      });

      let doneCalls = 0;
      var done = () => {
        // TODO: wait for stderr as well
        // spawn.test currently causes it to hang
        if (doneCalls++ === 1) {
          actuallyDone();
        }
      };
      var actuallyDone = function () {
        actuallyDone = done = () => {};
        proc?.stderr?.unref?.();
        proc?.stdout?.unref?.();
        proc?.unref?.();
        output = Buffer.concat(chunks).toString();
        finish();
      };

      // if (!KEEP_TMPDIR)
      //   proc.once("close", () => {
      //     rm(TMPDIR, { recursive: true, force: true }).catch(() => {});
      //   });

      proc.stdout.on("data", chunk => {
        chunks.push(chunk);
        if (run_concurrency === 1) process.stdout.write(chunk);
      });
      proc.stderr.on("data", chunk => {
        chunks.push(chunk);
        if (run_concurrency === 1) process.stderr.write(chunk);
      });

      proc.once("close", () => {
        activeTestObject.proc = undefined;
      });

      proc.once("exit", (code_, signal_) => {
        activeTestObject.proc = undefined;
        exitCode = code_;
        signal = signal_;
        if (signal || exitCode !== 0) {
          actuallyDone();
        } else {
          done();
        }
      });
      proc.once("error", err_ => {
        activeTestObject.proc = undefined;
        err = err_;
        actuallyDone();
      });
    });
  } finally {
    activeTests.delete(testFileName);
  }

  if (!hasInitialMaxFD) {
    getMaxFileDescriptor();
  } else if (maxFd > 0) {
    const prevMaxFd = maxFd;
    maxFd = getMaxFileDescriptor();
    if (maxFd > prevMaxFd + queue.concurrency * 2) {
      process.stderr.write(
        `\n\x1b[31mewarn\x1b[0;2m:\x1b[0m file descriptor leak in ${testFileName}, delta: ${
          maxFd - prevMaxFd
        }, current: ${maxFd}, previous: ${prevMaxFd}\n`,
      );
    }
  }

  const passed = exitCode === 0 && !err && !signal;

  let reason = "";
  if (!passed) {
    let match;
    if (err && err.message.includes("timed")) {
      reason = "hang";
    } else if ((match = output && output.match(/thread \d+ panic: (.*)\n/))) {
      reason = 'panic "' + match[1] + '"';
    } else if (err) {
      reason = (err.name || "Error") + ": " + err.message;
    } else if (signal) {
      reason = signal;
    } else if (exitCode === 1) {
      const failMatch = output.match(/\x1b\[31m\s(\d+) fail/);
      if (failMatch) {
        reason = failMatch[1] + " failing";
      } else {
        reason = "code 1";
      }
    } else {
      const x = windows && lookupWindowsError(exitCode);
      if (x) {
        if (x === "STATUS_BREAKPOINT") {
          if (output.includes("Segmentation fault at address")) {
            reason = "STATUS_ACCESS_VIOLATION";
          }
        }
        reason = x;
      } else {
        reason = "code " + exitCode;
      }
    }
  }

  const duration = (Date.now() - start) / 1000;

  if (run_concurrency !== 1 && enableProgressBar) {
    // clear line
    process.stdout.write("\x1b[2K\r");
  }

  console.log(
    `\x1b[2m${formatTime(duration).padStart(6, " ")}\x1b[0m ${
      passed ? "\x1b[32m✔" : "\x1b[31m✖"
    } ${testFileName}\x1b[0m${reason ? ` (${reason})` : ""}`,
  );

  finished++;

  if (run_concurrency !== 1 && enableProgressBar) {
    writeProgressBar();
  }

  if (run_concurrency > 1 && ci) {
    process.stderr.write(output);
  }

  if (!passed) {
    failing_tests.push({ path: testFileName, reason, output });
    process.exitCode = 1;
    if (err) console.error(err);
  } else {
    passing_tests.push(testFileName);
  }

  return passed;
}

var finished = 0;

function writeProgressBar() {
  const barWidth = Math.min(process.stdout.columns || 40, 80) - 2;
  const percent = (finished / total) * 100;
  const bar = "=".repeat(Math.floor(percent / 2));
  const str1 = `[${finished}/${total}] [${bar}`;
  process.stdout.write(`\r${str1}${" ".repeat(barWidth - str1.length)}]`);
}

const allTests = [...findTests(resolve(cwd, "test"))];
console.log(`Starting ${allTests.length} tests with ${run_concurrency} concurrency...`);
let total = allTests.length;
for (const path of allTests) {
  queue.add(
    async () =>
      await runTest(path).catch(e => {
        console.error("Bug in bun-internal-test");
        console.error(e);
        process.exit(1);
      }),
  );
}
await queue.onIdle();
console.log(`
Completed ${total} tests with ${failing_tests.length} failing tests
`);
console.log("\n");

function linkToGH(linkTo) {
  return `https://github.com/oven-sh/bun/blob/${git_sha}/${linkTo}`;
}

failing_tests.sort((a, b) => a.path.localeCompare(b.path));
passing_tests.sort((a, b) => a.localeCompare(b));

const failingTestDisplay = failing_tests.map(({ path, reason }) => `- \`${path}\` ${reason}`).join("\n");

// const passingTestDisplay = passing_tests.map(path => `- \`${path}\``).join("\n");

rmSync("report.md", { force: true });

const uptime = process.uptime();

function formatTime(seconds) {
  if (seconds < 60) {
    return seconds.toFixed(1) + "s";
  } else if (seconds < 60 * 60) {
    return (seconds / 60).toFixed(0) + "m " + formatTime(seconds % 60);
  } else {
    return (seconds / 60 / 60).toFixed(0) + "h " + formatTime(seconds % (60 * 60));
  }
}

const header = `
host:     ${process.env["GITHUB_RUN_ID"] ? "GitHub Actions: " : ""}${userInfo().username}@${hostname()}
platform: ${process.platform} ${process.arch}
bun:      ${argv0}
version:  v${revision}

date:     ${run_start.toISOString()}
duration: ${formatTime(uptime)}

total:    ${total} files
failing:  ${failing_tests.length} files
passing:  ${passing_tests.length} files

percent:  ${((passing_tests.length / total) * 100).toFixed(2)}%
`.trim();

console.log("\n" + "-".repeat(Math.min(process.stdout.columns || 40, 80)) + "\n");
console.log(header);
console.log("\n" + "-".repeat(Math.min(process.stdout.columns || 40, 80)) + "\n");

let report = `# bun test on ${
  process.env["GITHUB_REF"] ??
  spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf-8" }).stdout.trim()
}

\`\`\`
${header}
\`\`\`

`;

if (failingTestDisplay.length > 0) {
  report += `## Failing tests\n\n`;
  report += failingTestDisplay;
  report += "\n\n";
}

// if(passingTestDisplay.length > 0) {
//   report += `## Passing tests\n\n`;
//   report += passingTestDisplay;
//   report += "\n\n";
// }

if (failing_tests.length) {
  report += `## Failing tests log output\n\n`;
  for (const { path, output, reason } of failing_tests) {
    report += `### ${path}\n\n`;
    report += "[Link to file](" + linkToGH(path) + ")\n\n";
    report += `${reason}\n\n`;
    report += "```\n";

    let failing_output = output
      .replace(/\x1b\[[0-9;]*m/g, "")
      .replace(/^::(group|endgroup|error|warning|set-output|add-matcher|remove-matcher).*$/gm, "");

    if (failing_output.length > 1024 * 64) {
      failing_output = failing_output.slice(0, 1024 * 64) + `\n\n[truncated output (length: ${failing_output.length})]`;
    }

    report += failing_output;

    report += "```\n\n";
  }
}

writeFileSync("test-report.md", report);
writeFileSync(
  "test-report.json",
  JSON.stringify({
    failing_tests,
    passing_tests,
  }),
);

function mabeCapitalize(str) {
  str = str.toLowerCase();
  if (str.includes("arm64") || str.includes("aarch64")) {
    return str.toUpperCase();
  }

  if (str.includes("x64")) {
    return "x64";
  }

  if (str.includes("baseline")) {
    return str;
  }

  return str[0].toUpperCase() + str.slice(1);
}

console.log("-> test-report.md, test-report.json");
function linkify(text, url) {
  if (url?.startsWith?.("https://")) {
    return `[${text}](${url})`;
  }

  return text;
}

if (ci) {
  if (failing_tests.length > 0) {
    action.setFailed(`${failing_tests.length} files with failing tests`);
  }
  action.setOutput("failing_tests", failingTestDisplay);
  action.setOutput("failing_tests_count", failing_tests.length);
  if (failing_tests.length) {
    const { env } = process;
    const tag = process.env.BUN_TAG || "unknown";
    const url = `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;

    let comment = `## ${linkify(`${emojiTag(tag)}${failing_tests.length} failing tests`, url)} ${tag
      .split("-")
      .map(mabeCapitalize)
      .join(" ")}

${failingTestDisplay}

`;
    writeFileSync("comment.md", comment);
  }
  let truncated_report = report;
  if (truncated_report.length > 512 * 1000) {
    truncated_report = truncated_report.slice(0, 512 * 1000) + "\n\n...truncated...";
  }
  action.summary.addRaw(truncated_report);
  await action.summary.write();
}

function emojiTag(tag) {
  let emojiText = "";
  tag = tag.toLowerCase();
  if (tag.includes("win32") || tag.includes("windows")) {
    emojiText += "🪟";
  }

  if (tag.includes("linux")) {
    emojiText += "🐧";
  }

  if (tag.includes("macos") || tag.includes("darwin")) {
    emojiText += "";
  }

  if (tag.includes("x86") || tag.includes("x64") || tag.includes("_64") || tag.includes("amd64")) {
    if (!tag.includes("linux")) {
      emojiText += "💻";
    } else {
      emojiText += "🖥";
    }
  }

  if (tag.includes("arm64") || tag.includes("aarch64")) {
    emojiText += "💪";
  }

  if (emojiText) {
    emojiText += " ";
  }

  return emojiText;
}

process.exit(failing_tests.length ? 1 : process.exitCode);
