import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test as testWithoutCompiler } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

const note = (text: string) => `(globalThis.ran ??= []).push(${JSON.stringify(text)});`;
const print = (name: string) =>
  `await new Promise(done => setTimeout(done, 20)); console.log(${JSON.stringify(name)} + ": " + globalThis.ran);`;
const pkg = (name: string) => ({
  [`node_modules/${name}/package.json`]: `{ "name": "${name}", "main": "index.js" }`,
  [`node_modules/${name}/index.js`]: `${note(name)} module.exports = {};`,
});
const statement = (name: string, file: string) => `
  import { test } from "bun:test";
  import "./src/${file}";
  ${note("body")}
  test("prints", async () => { ${note("test")} ${print(name)} });`;

const sources = {
  "package.json": `{ "type": "module" }`,
  ...pkg("early"),
  ...pkg("late"),
  "src/last.cjs": `${note("last")} module.exports = {};`,
  "src/queues.cjs": `${note("queues")} process.nextTick(() => { ${note("TICK")} }); module.exports = {};`,
  "src/queues.mjs": `${note("queues")} process.nextTick(() => { ${note("TICK")} });`,
  "src/root.mjs": `import "early"; import "./queues.cjs"; import "late"; import "./last.cjs"; ${note("root")}`,
  "src/root.cjs": `require("early"); require("./queues.mjs"); require("./last.cjs"); ${note("root")}`,
  "1-first-tick-of-the-process.test.js": statement("first", "root.mjs"),
  "2-statement.test.js": statement("statement", "root.mjs"),
  "3-call.test.js": `
    import { test } from "bun:test";
    test("prints", async () => { await import("./src/root.mjs"); ${note("behind await")} ${print("call")} });`,
  "4-require.test.cjs": `
    const { test } = require("bun:test");
    test("prints", async () => { require("./src/root.mjs"); ${note("behind require")} ${print("require")} });`,
  "5-es-module-below-commonjs.test.js": statement("es module below commonjs", "root.cjs"),
};
const files = Object.keys(sources)
  .filter(name => name.includes(".test."))
  .map(name => "./" + name);

const asStockBunPrints = [
  "first: early,queues,TICK,late,last,root,body,test",
  "statement: early,queues,late,last,root,body,TICK,test",
  "call: early,queues,late,last,root,behind await,TICK",
  "require: early,queues,late,last,root,behind require,TICK",
  "es module below commonjs: early,queues,last,root,body,TICK,test",
];

async function printed(folder: string, flags: string[], transpilesOnOneThread: boolean, words = "") {
  const env = {
    ...bunEnv,
    NO_COLOR: "1",
    BUN_DEBUG_TEST_AOT_WORDS: words,
    BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: transpilesOnOneThread ? "1" : "0",
  };
  const { stdout } = await run([bunExe(), "test", "--isolate", ...flags, ...files], folder, env);
  return stdout.split("\n").filter(line => line.includes(": "));
}

testWithoutCompiler(
  "without --aot, each test file in a realm of its own",
  async () => {
    using dir = tempDir("only-the-first-tick-of-a-process", sources);
    expect(await printed(String(dir), [], true)).toEqual(asStockBunPrints);
  },
  240_000,
);

test.each([
  ["", false],
  ["TestRunLayers:0", true],
  ["TestRunLayers:0", false],
  ["TestRunLayers:2", true],
  ["TestRunLayers:3", false],
] as const)(
  "compiled: %s, texts read on the thread of the program: %p",
  async (words, transpilesOnOneThread) => {
    using dir = tempDir("only-the-first-tick-of-a-process", sources);
    expect(await printed(String(dir), ["--aot"], transpilesOnOneThread, words)).toEqual(asStockBunPrints);
  },
  240_000,
);
