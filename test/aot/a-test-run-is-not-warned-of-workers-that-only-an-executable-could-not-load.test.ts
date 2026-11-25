// The build of an executable warns where a Worker may start from a file or a text that it has not compiled: the executable fails to load it, or runs it in the interpreter.
// A test run loads such a file from disk, so the sentences are not true of it. It printed them all the same.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(60_000);

const starts = `
  if (process.argv.length > 99) new Worker(process.argv[99]);
  if (process.argv.length > 98) new Worker("./not-there.js");
  if (process.argv.length > 97) new Worker("data:text/javascript," + process.argv[97]);
  if (process.argv.length > 96) new Thread(process.argv[96]);
  if (process.argv.length > 95) new Thread(process.argv[95], { eval: true });
`;
const warnings = (text: string) => [...text.matchAll(/^warn: (TS\d+)/gm)].map(match => match[1]).sort();

test("a file in a test run starts itself as a Worker", async () => {
  using dir = tempDir("worker-of-own-file", {
    "own.mjs": `import { Worker, isMainThread, parentPort } from "node:worker_threads";
import { fileURLToPath } from "node:url";
const own = fileURLToPath(import.meta.url);
export const start = () => new Promise(resolve => new Worker(own).on("message", resolve).on("error", resolve));
if (!isMainThread) parentPort.postMessage("itself");`,
    "a.test.mjs": `import { expect, test } from "bun:test";
import { start } from "./own.mjs";
test("t", async () => expect(await start()).toBe("itself"));`,
  });
  const tested = await run([bunExe(), "test", "--aot", "./a.test.mjs"], String(dir));
  expect({ warnings: warnings(tested.stderr), exitCode: tested.exitCode }).toEqual({ warnings: [], exitCode: 0 });
});

test("a run that only checks warns of no Worker with a known file", async () => {
  using dir = tempDir("checked-workers", {
    "main.js": `import { join } from "node:path";
import { Worker as Thread } from "node:worker_threads";
console.log(typeof import.meta);
if (process.argv.length > 99) new Worker(join(import.meta.dir, "job.js"));
if (process.argv.length > 98) new Worker(new URL("./job.js", import.meta.url));
if (process.argv.length > 97) new Thread(new URL("./job.js", import.meta.url));`,
    "job.js": "",
  });
  const checked = await run([bunExe(), "--aot", "main.js"], String(dir));
  expect({ warnings: warnings(checked.stderr), exitCode: checked.exitCode }).toEqual({ warnings: [], exitCode: 0 });
});

test("the same starts of Workers: five warnings for an executable, none for a test run", async () => {
  using dir = tempDir("workers-nobody-follows", {
    "main.js": `import { Worker as Thread } from "node:worker_threads";${starts}console.log("none started");`,
    "a.test.js": `import { test } from "bun:test";
import { Worker as Thread } from "node:worker_threads";
test("t", () => {${starts}});`,
  });
  const cwd = String(dir);
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", "program"], cwd);
  expect({ warnings: warnings(built.stderr), exitCode: built.exitCode }).toEqual({
    warnings: ["TS100081", "TS100082", "TS100082", "TS100082", "TS100084"],
    exitCode: 0,
  });
  const tested = await run([bunExe(), "test", "--aot", "./a.test.js"], cwd);
  expect({ warnings: warnings(tested.stderr), exitCode: tested.exitCode }).toEqual({ warnings: [], exitCode: 0 });
});
