import * as action from "@actions/core";
import { spawnSync } from "child_process";
import { rmSync, writeFileSync, readFileSync, readdirSync } from "fs";
import { resolve } from "node:path";
import { platform, totalmem } from "os";
import { fileURLToPath } from "url";

const nativeMemory = totalmem();
const BUN_JSC_forceRAMSizeNumber = parseInt(process.env["BUN_JSC_forceRAMSize"] || "0", 10);
let BUN_JSC_forceRAMSize = Number(BigInt(nativeMemory) >> BigInt(2)) + "";
if (!(Number.isSafeInteger(BUN_JSC_forceRAMSizeNumber) && BUN_JSC_forceRAMSizeNumber > 0)) {
  BUN_JSC_forceRAMSize = BUN_JSC_forceRAMSizeNumber + "";
}

const cwd = resolve(fileURLToPath(import.meta.url), "../../../../");
process.chdir(cwd);

const isAction = !!process.env["GITHUB_ACTION"];

let isTestEnabled = () => true;

if (process.platform == "win32") {
  const testList = readFileSync("test/windows-test-allowlist.txt", "utf8")
    .replaceAll("\r", "")
    .split("\n")
    .map(x => x.trim().replaceAll("/", "\\"))
    .filter(x => !!x && !x.startsWith("#"));
  isTestEnabled = name => {
    return testList.some(testPattern => name.includes(testPattern));
  };
}

function* findTests(dir, query) {
  for (const entry of readdirSync(resolve(dir), { encoding: "utf-8", withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git") {
      yield* findTests(path, query);
    } else if (entry.name.includes(".test.") && isTestEnabled(path)) {
      yield path;
    }
  }
}

var failingTests = [];

let bunExe = process.argv[2] ?? "bun";
try {
  const { error } = spawnSync(bunExe, ["--revision"]);
  if (error) throw error;
} catch {
  console.error(bunExe + " is not installed");
}

async function runTest(path) {
  console.log(path);
  const name = path.replace(cwd, "").slice(1);
  try {
    var {
      stdout,
      stderr,
      status: exitCode,
      error: timedOut,
    } = spawnSync(bunExe, ["test", path.replaceAll("/", "\\")], {
      stdio: "inherit",
      timeout: 1000 * 60 * 3,
      env: {
        ...process.env,
        FORCE_COLOR: "1",
        BUN_GARBAGE_COLLECTOR_LEVEL: "1",
        BUN_JSC_forceRAMSize,
        // reproduce CI results locally
        GITHUB_ACTION: process.env.GITHUB_ACTION ?? "true",
        BUN_DEBUG_QUIET_LOGS: "1",
      },
    });
  } catch (e) {
    console.error(e);
  }

  const passed = exitCode === 0 && !timedOut;

  if (!passed) {
    failingTests.push(name);
    if (timedOut) console.error(timedOut);
  }
}

var tests = [];
var testFileNames = [];
for (const path of findTests(resolve(cwd, "test"))) {
  testFileNames.push(path);
  tests.push(runTest(path).catch(console.error));
}
await Promise.allSettled(tests);

rmSync("failing-tests.txt", { force: true });

if (isAction) {
  if (failingTests.length > 0) {
    action.setFailed(`${failingTests.length} files with failing tests`);
  }
  action.setOutput("failing_tests", failingTests.map(a => `- \`${a}\``).join("\n"));
  action.setOutput("failing_tests_count", failingTests.length);
  action.summary.addHeading(`${tests.length} files with tests ran`).addList(testFileNames);
  await action.summary.write();
} else {
  if (failingTests.length > 0) {
    console.log(`${failingTests.length} files with failing tests:`);
    for (const test of failingTests) {
      console.log(`- ${resolve(test)}`);
    }
  }
  writeFileSync("failing-tests.txt", failingTests.join("\n"));
}

process.exit(Math.min(failingTests.length, 127));
