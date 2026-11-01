import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runtimeEnvironment } from "./harness/flags";
import { run } from "./harness/run";
// One by one: the runner gives this file a process of its own and eight cases at once, beside two more like it: too many builds for four cores.
import { testOneByOne as test } from "./supported";

// Compiled or not, the realm of a Worker has none of the names of the test runner.
const answer = `typeof expect === "undefined" && typeof jest === "undefined" ? "answers" : "sees the test runner"`;
const web = `postMessage(${answer});\n`;
const node = `require("node:worker_threads").parentPort.postMessage(${answer});\n`;
const modules: [string, string, string][] = [
  ["url", `new Worker(new URL("./url.js", import.meta.url))`, web],
  ["href", `new Worker(new URL("./href.js", import.meta.url).href)`, web],
  ["metaResolve", `new Worker(import.meta.resolve("./metaResolve.js"))`, web],
  ["metaDir", `new Worker(import.meta.dir + "/metaDir.js")`, web],
  ["nodeUrl", `new threads.Worker(new URL("./nodeUrl.js", import.meta.url))`, node],
];
const scripts: [string, string, string][] = [
  ["resolve", `new Worker(require.resolve("./resolve.js"))`, web],
  ["join", `new Worker(require("node:path").join(__dirname, "join.js"))`, web],
  ["bare", `new Worker("of-old/bare.js")`, web],
  ["nodeJoin", `new threads.Worker(require("node:path").join(__dirname, "nodeJoin.js"))`, node],
  ["nodeResolve", `new threads.Worker(require.resolve("./nodeResolve.js"))`, node],
];
const names = [...modules, ...scripts].map(([name]) => name);
const asks = `async (starts, names) => {
  for (const name of names) {
    const worker = starts[name]();
    const got = await new Promise(done => {
      const take = value => done(value?.data ?? value);
      worker.onmessage = take;
      worker.on?.("message", take);
      worker.onerror = event => done("error");
      worker.on?.("error", () => done("error"));
    });
    console.log("SEEN", name, got);
    await worker.terminate();
  }
}`;
const files = {
  "package.json": `{ "name": "p" }`,
  "node_modules/of-today/package.json": `{ "name": "of-today", "type": "module", "main": "index.js" }`,
  // As thread-stream ships one. It says how the author builds the package, and nothing about a program that uses it.
  "node_modules/of-today/tsconfig.json": `{}`,
  "node_modules/of-today/index.js":
    `import * as threads from "node:worker_threads";\n` +
    modules.map(([name, starts]) => `export const ${name} = () => ${starts};\n`).join(""),
  "node_modules/of-old/package.json": `{ "name": "of-old", "main": "index.js" }`,
  "node_modules/of-old/index.js":
    `const threads = require("node:worker_threads");\n` +
    scripts.map(([name, starts]) => `exports.${name} = () => ${starts};\n`).join(""),
  ...Object.fromEntries(modules.map(([name, , text]) => [`node_modules/of-today/${name}.js`, text])),
  ...Object.fromEntries(scripts.map(([name, , text]) => [`node_modules/of-old/${name}.js`, text])),
  "a.test.js": `import { test } from "bun:test";\nimport * as today from "of-today";\nimport * as old from "of-old";\ntest("first", () => (${asks})({ ...today, ...old }, ${JSON.stringify(names)}));\n`,
  "b.test.js": `import { test } from "bun:test";\ntest("second", () => {});\n`,
};
const answers = names.map(name => `SEEN ${name} answers`);
const seenIn = (text: string) => text.split("\n").filter(line => line.startsWith("SEEN"));

test.each([
  ["TestRunLayers:2", []],
  ["TestRunLayers:3", ["--isolate"]],
])("%s %j", async (words, flags) => {
  using dir = tempDir("aot-package-worker-compiled", files);
  const cwd = String(dir);
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot", "--timeout=60000", ...flags], cwd, {
    ...bunEnv,
    BUN_DEBUG_TEST_AOT_WORDS: words,
    BUN_JSC_logAOTPhaseTimes: "1",
    [runtimeEnvironment.countsPath]: join(cwd, "counts-%p"),
  });
  const counted = readdirSync(cwd)
    .filter(name => name.startsWith("counts-"))
    .flatMap(name => readFileSync(join(cwd, name), "utf8").split("\n"));
  expect({
    seen: seenIn(stdout + stderr),
    exitCode,
    // Each Worker writes its own counts. Where none does, a sum of zero says nothing.
    workersCounted: counted.filter(line => line.endsWith("\tcounter:InterpretedModuleCode")).length > names.length,
    // The load of the layer finds the files and goes on with them. A build that starts over loads every file of the packages twice.
    startsOver: stderr
      .split("\n")
      .filter(line => line.startsWith("AOT build starts over | files that Workers start from")),
    interpreted: counted
      .filter(line => /\tcounter:Interpreted(Function|Global|Eval|Module)Code$/.test(line))
      .reduce((sum, line) => sum + Number(line.split("\t")[0]), 0),
  }).toEqual({ seen: answers, exitCode: 0, workersCounted: true, startsOver: [], interpreted: 0 });
});

test("as one program each Worker writes its counts too", async () => {
  using dir = tempDir("aot-package-worker-compiled", files);
  const cwd = String(dir);
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot", "--timeout=60000"], cwd, {
    ...bunEnv,
    BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0",
    [runtimeEnvironment.countsPath]: join(cwd, "counts-%p"),
  });
  const counted = readdirSync(cwd)
    .filter(name => name.startsWith("counts-"))
    .flatMap(name => readFileSync(join(cwd, name), "utf8").split("\n"));
  expect({
    seen: seenIn(stdout + stderr),
    exitCode,
    workersCounted: counted.filter(line => line.endsWith("\tcounter:InterpretedModuleCode")).length > names.length,
  }).toEqual({ seen: answers, exitCode: 0, workersCounted: true });
});
