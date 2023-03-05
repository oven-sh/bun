import * as action from "@actions/core";
import { spawnSync } from "child_process";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "url";

const cwd = resolve(fileURLToPath(import.meta.url), "../../../../");
process.chdir(cwd);

const isAction = !!process.env["GITHUB_ACTION"];
const errorPattern = /error: ([\S\s]*?)(?=\n.*?at (\/.*):(\d+):(\d+))/gim;

function* findTests(dir, query) {
  for (const entry of readdirSync(resolve(dir), { encoding: "utf-8", withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      yield* findTests(path, query);
    } else if (entry.isFile() && entry.name.includes(".test.")) {
      yield path;
    }
  }
}

async function runTest(path) {
  const name = path.replace(cwd, "").slice(1);
  const {
    stdout,
    stderr,
    status: exitCode,
  } = spawnSync("bun", ["test", path], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10_000,
    env: {
      ...process.env,
      FORCE_COLOR: "1",
    },
  });
  if (isAction) {
    const prefix = +exitCode === 0 ? "PASS" : `FAIL`;
    action.startGroup(`${prefix} - ${name}`);
  }

  process.stdout.write(stdout);

  if (isAction) {
    findErrors(stdout);
    process.stdout.write(stderr);

    findErrors(stderr);
  } else {
    process.stdout.write(stderr);
    findErrors(stderr);
  }

  if (isAction) {
    action.endGroup();
  }
}

let failed = false;

function findErrors(data) {
  const text = new StringDecoder().write(new Buffer(data.buffer));
  for (const [message, _, path, line, col] of text.matchAll(errorPattern)) {
    failed = true;
    action.error(message, {
      file: path.replace(cwd, "").slice(1),
      startLine: parseInt(line),
      startColumn: parseInt(col),
    });
  }
}

const tests = [];
for (const path of findTests(resolve(cwd, "test/bun.js"))) {
  tests.push(runTest(path).catch(console.error));
}
await Promise.allSettled(tests);
process.exit(failed ? 1 : 0);
