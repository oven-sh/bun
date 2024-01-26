import * as action from "@actions/core";
import { spawn, spawnSync } from "child_process";
import { rmSync, writeFileSync, readFileSync } from "fs";
import { readFile } from "fs/promises";
import { readdirSync } from "node:fs";
import { resolve, basename } from "node:path";
import { cpus, hostname, totalmem, userInfo } from "os";
import { fileURLToPath } from "url";

const run_start = new Date();

const windows = process.platform === "win32";

const nativeMemory = totalmem();
const force_ram_size_input = parseInt(process.env["BUN_JSC_forceRAMSize"] || "0", 10);
let force_ram_size = Number(BigInt(nativeMemory) >> BigInt(2)) + "";
if (!(Number.isSafeInteger(force_ram_size_input) && force_ram_size_input > 0)) {
  force_ram_size = force_ram_size_input + "";
}

const cwd = resolve(fileURLToPath(import.meta.url), "../../../../");
process.chdir(cwd);

const ci = !!process.env["GITHUB_ACTIONS"];
const enableProgressBar = !ci;

function defaultConcurrency() {
  // Concurrency causes more flaky tests, only enable it by default on windows
  // See https://github.com/oven-sh/bun/issues/8071
  if (windows) {
    return Math.floor((cpus().length - 2) / 2);
  }
  return 1;
}

const run_concurrency = Math.max(Number(process.env["BUN_TEST_CONCURRENCY"] || defaultConcurrency(), 10), 1);

const extensions = [".js", ".ts", ".jsx", ".tsx"];

const git_sha =
  process.env["GITHUB_SHA"] ?? spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).stdout.trim();

function isTest(path) {
  if (!basename(path).includes(".test.") || !extensions.some(ext => path.endsWith(ext))) {
    return false;
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

// pick the last one, kind of a hack to allow 'bun run test bun-release' to test the release build
let bunExe = (process.argv.length > 2 ? process.argv[process.argv.length - 1] : null) ?? "bun";
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
const fixes = [];
const regressions = [];

async function runTest(path) {
  const name = path.replace(cwd, "").slice(1);
  let exitCode, signal, err, output;

  const expected_crash_reason = windows
    ? await readFile(resolve(path), "utf-8").then(data => {
        const match = data.match(/@known-failing-on-windows:(.*)\n/);
        return match ? match[1].trim() : null;
      })
    : null;

  const start = Date.now();

  await new Promise((done, reject) => {
    const proc = spawn(bunExe, ["test", resolve(path)], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 1000 * 60 * 3,
      env: {
        ...process.env,
        FORCE_COLOR: "1",
        BUN_GARBAGE_COLLECTOR_LEVEL: "1",
        BUN_JSC_forceRAMSize: force_ram_size,
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
        // reproduce CI results locally
        GITHUB_ACTIONS: process.env.GITHUB_ACTIONS ?? "true",
        BUN_DEBUG_QUIET_LOGS: "1",
      },
    });

    const chunks = [];
    proc.stdout.on("data", chunk => {
      chunks.push(chunk);
      if (run_concurrency === 1) process.stdout.write(chunk);
    });
    proc.stderr.on("data", chunk => {
      chunks.push(chunk);
      if (run_concurrency === 1) process.stderr.write(chunk);
    });

    proc.on("exit", (code_, signal_) => {
      exitCode = code_;
      signal = signal_;
      output = Buffer.concat(chunks).toString();
      done();
    });
    proc.on("error", err_ => {
      err = err_;
      done();
    });
  });

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
      passed ? "\x1b[32m✔" : expected_crash_reason ? "\x1b[33m⚠" : "\x1b[31m✖"
    } ${name}\x1b[0m${reason ? ` (${reason})` : ""}`,
  );

  finished++;

  if (run_concurrency !== 1 && enableProgressBar) {
    writeProgressBar();
  }

  if (run_concurrency > 1 && ci) {
    process.stderr.write(output);
  }

  if (!passed) {
    if (reason) {
      if (windows && !expected_crash_reason) {
        regressions.push({ path: name, reason, output });
      }
    }

    failing_tests.push({ path: name, reason, output, expected_crash_reason });
    if (err) console.error(err);
  } else {
    if (windows && expected_crash_reason !== null) {
      fixes.push({ path: name, output, expected_crash_reason });
    }

    passing_tests.push(name);
  }
}

const queue = [...findTests(resolve(cwd, "test"))];
let running = 0;
let total = queue.length;
let finished = 0;
let on_entry_finish = null;

function writeProgressBar() {
  const barWidth = Math.min(process.stdout.columns || 40, 80) - 2;
  const percent = (finished / total) * 100;
  const bar = "=".repeat(Math.floor(percent / 2));
  const str1 = `[${finished}/${total}] [${bar}`;
  process.stdout.write(`\r${str1}${" ".repeat(barWidth - str1.length)}]`);
}

while (queue.length > 0) {
  if (running >= run_concurrency) {
    await new Promise(resolve => (on_entry_finish = resolve));
    continue;
  }

  const path = queue.shift();
  running++;
  runTest(path)
    .catch(e => {
      console.error("Bug in bun-internal-test");
      console.error(e);
      process.exit(1);
    })
    .finally(() => {
      running--;
      if (on_entry_finish) {
        on_entry_finish();
        on_entry_finish = null;
      }
    });
}
while (running > 0) {
  await Promise.race([
    new Promise(resolve => (on_entry_finish = resolve)),
    new Promise(resolve => setTimeout(resolve, 1000)),
  ]);
}
console.log("\n");

function linkToGH(linkTo) {
  return `https://github.com/oven-sh/bun/blob/${git_sha}/${linkTo}`;
}

function sectionLink(linkTo) {
  return "#" + linkTo.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase();
}

const failingTestDisplay = failing_tests
  .filter(({ reason }) => !regressions.some(({ path }) => path === path))
  .map(({ path, reason }) => `- [\`${path}\`](${sectionLink(path)})${reason ? ` ${reason}` : ""}`)
  .join("\n");
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

if (fixes.length > 0) {
  report += `## Fixes\n\n`;
  report += "The following tests had @known-failing-on-windows but now pass:\n\n";
  report += fixes
    .map(
      ({ path, expected_crash_reason }) => `- [\`${path}\`](${sectionLink(path)}) (before: ${expected_crash_reason})`,
    )
    .join("\n");
  report += "\n\n";
}

if (regressions.length > 0) {
  report += `## Regressions\n\n`;
  report += regressions
    .map(
      ({ path, reason, expected_crash_reason }) =>
        `- [\`${path}\`](${sectionLink(path)}) ${reason}${
          expected_crash_reason ? ` (expected: ${expected_crash_reason})` : ""
        }`,
    )
    .join("\n");
  report += "\n\n";
}

if (failingTestDisplay.length > 0) {
  report += `## ${windows ? "Known " : ""}Failing tests\n\n`;
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
  for (const { path, output, reason, expected_crash_reason } of failing_tests) {
    report += `### ${path}\n\n`;
    report += "[Link to file](" + linkToGH(path) + ")\n\n";
    if (windows && reason !== expected_crash_reason) {
      report += `To mark this as a known failing test, add this to the start of the file:\n`;
      report += `\`\`\`ts\n`;
      report += `// @known-failing-on-windows: ${reason}\n`;
      report += `\`\`\`\n\n`;
    } else {
      report += `${reason}\n\n`;
    }
    report += "```\n";
    report += output
      .replace(/\x1b\[[0-9;]*m/g, "")
      .replace(/^::(group|endgroup|error|warning|set-output|add-matcher|remove-matcher).*$/gm, "");
    report += "```\n\n";
  }
}

writeFileSync("test-report.md", report);
writeFileSync(
  "test-report.json",
  JSON.stringify({
    failing_tests,
    passing_tests,
    fixes,
    regressions,
  }),
);

console.log("-> test-report.md, test-report.json");

if (ci) {
  if (windows) {
    if (regressions.length > 0) {
      action.setFailed(`${regressions.length} regressing tests`);
    }
    action.setOutput("regressing_tests", regressions.map(({ path }) => `- \`${path}\``).join("\n"));
    action.setOutput("regressing_test_count", regressions.length);
  } else {
    if (failing_tests.length > 0) {
      action.setFailed(`${failing_tests.length} files with failing tests`);
    }
    action.setOutput("failing_tests", failingTestDisplay);
    action.setOutput("failing_tests_count", failing_tests.length);
  }
  let truncated_report = report;
  if (truncated_report.length > 512 * 1000) {
    truncated_report = truncated_report.slice(0, 512 * 1000) + "\n\n...truncated...";
  }
  action.summary.addRaw(truncated_report);
  await action.summary.write();
} else {
  if (windows && (regressions.length > 0 || fixes.length > 0)) {
    console.log(
      "\n\x1b[34mnote\x1b[0;2m:\x1b[0m If you would like to update the @known-failing-on-windows annotations, run `bun update-known-failures`",
    );
  }
}

process.exit(failing_tests.length ? 1 : 0);
