import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runtimeEnvironment } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

// A package starts a Worker from a file of its own that nothing imports, as piscina, tinypool and workerpool do.
// Compiled or not, the realm of a Worker has none of the names of the test runner.
const answer = `typeof expect === "undefined" && typeof jest === "undefined" ? "answers" : "sees the test runner"`;
const web = `postMessage(${answer});\n`;
const names = ["url", "resolve"];
const asks = `async (starts, names) => {
  for (const name of names) {
    const worker = starts[name]();
    const got = await new Promise(done => {
      worker.onmessage = event => done(event.data);
      worker.onerror = event => done("error");
    });
    console.log("SEEN", name, got);
    await worker.terminate();
  }
}`;
const files = {
  "package.json": `{ "name": "p" }`,
  "node_modules/of-today/package.json": `{ "name": "of-today", "type": "module", "main": "index.js" }`,
  "node_modules/of-today/index.js": `export const url = () => new Worker(new URL("./url.js", import.meta.url));\n`,
  "node_modules/of-today/url.js": web,
  "node_modules/of-old/package.json": `{ "name": "of-old", "main": "index.js" }`,
  "node_modules/of-old/index.js": `exports.resolve = () => new Worker(require.resolve("./resolve.js"));\n`,
  "node_modules/of-old/resolve.js": web,
  "a.test.js": `import { test } from "bun:test";\nimport * as today from "of-today";\nimport * as old from "of-old";\ntest("first", () => (${asks})({ ...today, ...old }, ${JSON.stringify(names)}));\n`,
  "b.test.js": `import { test } from "bun:test";\ntest("second", () => {});\n`,
};
const answers = names.map(name => `SEEN ${name} answers`);

async function ran(words: string) {
  using dir = tempDir("aot-package-worker-compiled", files);
  const cwd = String(dir);
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot", "--timeout=60000"], cwd, {
    ...bunEnv,
    BUN_DEBUG_TEST_AOT_WORDS: words,
    BUN_JSC_logAOTPhaseTimes: "1",
    [runtimeEnvironment.countsPath]: join(cwd, "counts-%p"),
  });
  const counted = readdirSync(cwd)
    .filter(name => name.startsWith("counts-"))
    .flatMap(name => readFileSync(join(cwd, name), "utf8").split("\n"));
  return {
    seen: (stdout + stderr).split("\n").filter(line => line.startsWith("SEEN")),
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
  };
}

test("as one program each Worker writes its counts too", async () => {
  expect(await ran("TestRunLayers:0")).toMatchObject({ seen: answers, exitCode: 0, workersCounted: true });
});
