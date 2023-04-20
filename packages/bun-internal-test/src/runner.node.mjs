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

function dump(buf) {
  var offset = 0,
    length = buf.byteLength;
  while (offset < length) {
    try {
      const wrote = writeSync(1, buf);
      offset += wrote;
      if (offset < length) {
        try {
          fsyncSync(1);
        } catch (e) {}

        buf = buf.slice(wrote);
      }
    } catch (e) {
      if (e.code === "EAGAIN") {
        continue;
      }

      throw e;
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
      stdio: ["ignore", "pipe", "pipe"],
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

  if (isAction && !passed) {
    findErrors(stdout);
    findErrors(stderr);
  }

  if (isAction) {
    const prefix = passed ? "PASS" : `FAIL`;
    action.startGroup(`${prefix} - ${name}`);
  }

  stdout && stdout?.byteLength && dump(stdout);
  stderr && stderr?.byteLength && dump(stderr);

  if (isAction) {
    action.endGroup();
  }
}

function findErrors(data) {
  const text = new StringDecoder().write(new Buffer(data.buffer)).replaceAll(/\u001b\[.*?m/g, "");
  let index = 0;
  do {
    index = text.indexOf("error: ", index);
    if (index === -1) {
      break;
    }

    const messageEnd = text.indexOf("\n", index);
    if (messageEnd === -1) {
      break;
    }
    const message = text.slice(index + 7, messageEnd);
    index = text.indexOf("at ", index);
    if (index === -1) {
      break;
    }
    const startAt = index;
    index = text.indexOf("\n", index);
    if (index === -1) {
      break;
    }
    const at = text.slice(startAt + 3, index);
    let file = at.slice(0, at.indexOf(":"));
    if (file.length === 0) {
      continue;
    }

    const startLine = at.slice(at.indexOf(":") + 1, at.indexOf(":") + 1 + at.slice(at.indexOf(":") + 1).indexOf(":"));
    const startColumn = at.slice(at.indexOf(":") + 1 + at.slice(at.indexOf(":") + 1).indexOf(":") + 1);

    if (file.startsWith("/")) {
      file = relative(cwd, file);
    }

    action.error(message, { file, startLine, startColumn });
  } while (index !== -1);
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
