import * as action from "@actions/core";
import { spawnSync } from "child_process";
import { fsyncSync, rmSync, writeFileSync, writeSync } from "fs";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { relative } from "path";
import { fileURLToPath } from "url";

const cwd = resolve(fileURLToPath(import.meta.url), "../../../../");
process.chdir(cwd);

const isAction = !!process.env["GITHUB_ACTION"];

function* findTests(dir, query) {
  for (const entry of readdirSync(resolve(dir), { encoding: "utf-8", withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      yield* findTests(path, query);
    } else if (entry.name.includes(".test.")) {
      yield path;
    }
  }
}

var failingTests = [];

async function runTest(path) {
  const name = path.replace(cwd, "").slice(1);
  try {
    var {
      stdout,
      stderr,
      status: exitCode,
      error: timedOut,
    } = spawnSync("bun", ["test", path], {
      stdio: "inherit",
      timeout: 1000 * 60 * 3,
      env: {
        ...process.env,
        FORCE_COLOR: "1",
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
  writeFileSync("failing-tests.txt", failingTests.join("\n"));
}

process.exit(failingTests.length);
