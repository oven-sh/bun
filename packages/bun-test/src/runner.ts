import { spawn } from "bun";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import * as action from "@actions/core";

const cwd = resolve("../..");
const isAction = !!process.env["GITHUB_ACTION"];
const errorPattern = /error: ([\S\s]*?)(?=\n.*?at (\/.*):(\d+):(\d+))/mgi;

function* findTests(dir: string, query?: string): Generator<string> {
  for (const entry of readdirSync(resolve(dir), { encoding: "utf-8", withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      yield* findTests(path, query);
    } else if (entry.isFile() && entry.name.includes(".test.")) {
      yield path;
    }
  }
}

async function runTest(path: string): Promise<void> {
  const name = path.replace(cwd, "").slice(1);
  const runner = await spawn({
    cwd,
    cmd: ["bun", "wiptest", path],
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await Promise.race([
    new Promise((resolve) => {
      setTimeout(() => {
        runner.kill();
        resolve(124); // Timed Out
      }, 60_000);
    }),
    runner.exited,
  ]);
  if (isAction) {
    const prefix = exitCode === 0
      ? "PASS"
      : `FAIL (exit code ${exitCode})`;
    action.startGroup(`${prefix} - ${name}`);
  }
  for (const stdout of [runner.stdout, runner.stderr]) {
    if (!stdout) {
      continue;
    }
    const reader = stdout.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (value) {
        console.write(value);
        if (isAction) {
          findErrors(value);
        }
      }
      if (done) {
        break;
      }
    }
  }
  if (isAction) {
    action.endGroup();
  }
}

let failed = false;

function findErrors(data: Uint8Array): void {
  const text = new TextDecoder().decode(data);
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
