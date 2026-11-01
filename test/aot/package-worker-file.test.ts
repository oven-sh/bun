import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { renameSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
// One by one: the runner gives this file a process of its own and eight cases at once, beside two more like it: too many builds for four cores.
import { testOneByOne as test } from "./supported";

const files = {
  "package.json": `{ "name": "p" }`,
  "node_modules/itself/package.json": `{ "name": "itself", "main": "index.js" }`,
  "node_modules/itself/index.js": `const { Worker, isMainThread, parentPort } = require("node:worker_threads");
if (isMainThread) exports.start = () => new Worker(__filename);
else parentPort.postMessage("answers");
`,
  "node_modules/its-url/package.json": `{ "name": "its-url", "type": "module", "main": "index.js" }`,
  "node_modules/its-url/index.js": `export const start = () => new Worker(import.meta.url);
if (!Bun.isMainThread) postMessage("answers");
`,
  "node_modules/imported/package.json": `{ "name": "imported", "main": "index.js" }`,
  "node_modules/imported/index.js": `require("./job.js");
exports.start = () => new Worker(require("node:path").join(__dirname, "job.js"));
`,
  "node_modules/imported/job.js": `if (!Bun.isMainThread) postMessage("answers");\n`,
  "asks.js": `export async function ask(name, start) {
  const worker = start();
  const got = await new Promise(done => {
    const take = value => done(value?.data ?? value);
    worker.onmessage = take;
    worker.on?.("message", take);
    worker.onerror = () => done("error");
    worker.on?.("error", () => done("error"));
  });
  console.log("SEEN", name, got);
  await worker.terminate();
}
`,
  "all.js": `import { ask } from "./asks.js";
import * as itself from "itself";
import * as itsUrl from "its-url";
import * as imported from "imported";
export async function askAll() {
  await ask("itself", itself.start);
  await ask("its-url", itsUrl.start);
  await ask("imported", imported.start);
}
`,
  "main.js": `import { askAll } from "./all.js";\nawait askAll();\nprocess.exit(0);\n`,
  "a.test.js": `import { test } from "bun:test";\nimport { askAll } from "./all.js";\ntest("each answers", askAll);\n`,
};
const answers = ["itself", "its-url", "imported"].map(name => `SEEN ${name} answers`);
const seenIn = (text: string) => text.split("\n").filter(line => line.startsWith("SEEN"));

test("in an executable whose sources are moved away", async () => {
  using dir = tempDir("aot-package-worker-file", files);
  const cwd = String(dir);
  expect(seenIn((await run([bunExe(), "run", "main.js"], cwd, bunEnv)).stdout)).toEqual(answers);
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", "compiled"], cwd, bunEnv);
  expect({ exitCode: built.exitCode, said: built.exitCode ? built.stdout + built.stderr : "" }).toEqual({
    exitCode: 0,
    said: "",
  });
  renameSync(join(cwd, "node_modules"), join(cwd, "moved-away"));
  expect(seenIn((await run([join(cwd, "compiled")], cwd, bunEnv)).stdout)).toEqual(answers);
});

test.each([[["test"]], [["test", "--aot"]]])("in a test run: bun %j", async command => {
  using dir = tempDir("aot-package-worker-file", files);
  const { stdout, stderr, exitCode } = await run([bunExe(), ...command, "--timeout=60000"], String(dir), bunEnv);
  expect({ seen: seenIn(stdout + stderr), exitCode }).toEqual({ seen: answers, exitCode: 0 });
});

test("in a test run over two layers", async () => {
  using dir = tempDir("aot-package-worker-file", files);
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2" };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot", "--timeout=60000"], String(dir), env);
  expect({ seen: seenIn(stdout + stderr), exitCode }).toEqual({ seen: answers, exitCode: 0 });
});

// The Worker of such a package starts from a file that nothing imports, which the build leaves out. The folder and the URL in the path lead to the package's own index.js.
test("a part of the path is not the file", async () => {
  using dir = tempDir("aot-package-worker-file", {
    "package.json": `{ "name": "p" }`,
    "node_modules/by-folder/package.json": `{ "name": "by-folder", "main": "index.js" }`,
    "node_modules/by-folder/index.js": `exports.start = () => new Worker(require("node:path").join(__dirname, "lib", "job.js"));\n`,
    "node_modules/by-folder/lib/job.js": `postMessage("answers");\n`,
    "node_modules/by-url/package.json": `{ "name": "by-url", "type": "module", "main": "index.js" }`,
    "node_modules/by-url/index.js": `import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
export const start = () => new Worker(join(dirname(fileURLToPath(import.meta.url)), "job.js"));
`,
    "node_modules/by-url/job.js": `postMessage("answers");\n`,
    "a.test.js": `import { test, expect } from "bun:test";
import * as byFolder from "by-folder";
import * as byUrl from "by-url";
test("both load", () => expect([typeof byFolder.start, typeof byUrl.start]).toEqual(["function", "function"]));
`,
  });
  const env = { ...bunEnv, BUN_JSC_logAOTPhaseTimes: "1" };
  const { stderr, exitCode } = await run([bunExe(), "test", "--aot"], String(dir), env);
  expect({
    taken: stderr.split("\n").filter(line => line.includes("files that Workers start from")),
    exitCode,
  }).toEqual({
    taken: [],
    exitCode: 0,
  });
});
