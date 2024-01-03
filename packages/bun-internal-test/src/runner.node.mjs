import * as action from "@actions/core";
import { spawnSync } from "child_process";
import { rmSync, writeFileSync, readFileSync } from "fs";
import { readdirSync } from "node:fs";
import { resolve, basename } from "node:path";
import { totalmem } from "os";
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

let testList = [];
if (process.platform == "win32") {
  testList = readFileSync("test/windows-test-allowlist.txt", "utf8")
    .replaceAll("\r", "")
    .split("\n")
    .map(x => x.trim().replaceAll("/", "\\"))
    .filter(x => !!x && !x.startsWith("#"));
}

const extensions = [".js", ".ts", ".jsx", ".tsx"];

function isTest(path) {
  if (!basename(path).includes(".test.") || !extensions.some(ext => path.endsWith(ext))) {
    return false;
  }
  if (testList.length > 0) {
    return testList.some(testPattern => path.includes(testPattern));
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

var failingTests = [];

let bunExe = process.argv[2] ?? "bun";
try {
  const { error } = spawnSync(bunExe, ["--revision"]);
  if (error) throw error;
} catch {
  console.error(bunExe + " is not installed");
}

const ntStatusPath = 'C:\\Program Files (x86)\\Windows Kits\\10\\Include\\10.0.22621.0\\shared\\ntstatus.h';
let ntStatusHCached = null;
function lookupWindowsError(code) {
  if (ntStatusHCached === null) {
    try {
      ntStatusHCached = readFileSync(ntStatusPath, 'utf-8');
    } catch {
      console.error(`could not find ntstatus.h to lookup error code: ${ntStatusPath}`);
      ntStatusHCached = '';
    }
  }
  const match = ntStatusHCached.match(new RegExp(`(STATUS_\\w+).*0x${code.toString(16)}`, 'i'));
  if (match) {
    return match[1];
  }
  return `unknown`;
}

async function runTest(path) {
  const name = path.replace(cwd, "").slice(1);
  try {
    var {
      stdout,
      stderr,
      status: exitCode,
      signal,
      error: timedOut,
    } = spawnSync(bunExe, ["test", resolve(path)], {
      stdio: "inherit",
      timeout: 1000 * 60 * 3,
      env: {
        ...process.env,
        FORCE_COLOR: "1",
        BUN_GARBAGE_COLLECTOR_LEVEL: "1",
        BUN_JSC_forceRAMSize,
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
        // reproduce CI results locally
        GITHUB_ACTION: process.env.GITHUB_ACTION ?? "true",
        BUN_DEBUG_QUIET_LOGS: "1",
      },
    });
  } catch (e) {
    console.error(e);
  }

  if(signal) {
    console.error(`Test ${name} was killed by signal ${signal}`);
  }

  if(process.platform === 'win32' && exitCode > 256) {
    console.error(`Test ${name} crashed with exit code ${exitCode.toString(16)} (${lookupWindowsError(exitCode)})`);
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
