import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `require.cache[require.resolve("./data.json")].exports = other`: the next `require("./data.json")` answers `other`.
// The entry of a data file or of an ES module is an object that the run time makes when it is asked for. The calls of `require` that the build had bound kept an answer of their own,
// which the store did not reach, and the build took what they answer for the file's own object.
const files: Record<string, string> = {
  "package.json": `{ "type": "module" }`,
  "data.json": `{ "value": 1 }`,
  "other.json": `{ "value": 2 }`,
  "number.json": `{ "value": 3 }`,
  "esm.mjs": `export const value = "esm";`,
  "evicted.mjs": `export const value = "evicted";`,
  "members.mjs": `export const value = "esm"; export let count = 1; export function name() { return "of the module"; }`,
  "plain.cjs": `exports.value = "cjs";`,
  "a.test.ts": `import { test } from "bun:test";
const say = (...words: unknown[]) => console.log("SEEN", ...words);
const entryOf = (path: string) => require.cache[require.resolve(path)]!;
function askForModule() { return require("./esm.mjs"); }
test("stores into the entries of require.cache", () => {
  const data = require("./data.json");
  say("a data file, before:", entryOf("./data.json").exports === data, require("./data.json").value);
  entryOf("./data.json").exports = { value: "stored" };
  say("a data file:", require("./data.json").value, data.value, require("./data.json") === entryOf("./data.json").exports);
  const other = require("./other.json");
  entryOf("./other.json").exports = { first: 5, second: 6, value: "of another shape" };
  say("an object of another shape:", require("./other.json").value, other.value);
  const number = require("./number.json");
  entryOf("./number.json").exports = 7;
  say("a number:", require("./number.json"), require("./number.json").value, number.value);
  const esm = askForModule();
  entryOf("./esm.mjs").exports = { value: "stored in place of a module" };
  say("an ES module:", askForModule().value, esm.value, askForModule() === entryOf("./esm.mjs").exports);
  const members = require("./members.mjs");
  entryOf("./members.mjs").exports = { value: "stored", count: 2, name() { return "of the stored"; } };
  const again = require("./members.mjs");
  say("members read where the module is required:", again.value, again.count, again.name(), require("./members.mjs").value, members.value, members.count, members.name());
  const { value, count } = require("./members.mjs");
  say("by a pattern:", value, count);
  const evicted = require("./evicted.mjs");
  entryOf("./evicted.mjs").exports = { value: "stored" };
  say("an ES module that is taken out later:", require("./evicted.mjs").value, evicted.value);
  delete require.cache[require.resolve("./evicted.mjs")];
  say("taken out:", require("./evicted.mjs").value);
  const cjs = require("./plain.cjs");
  entryOf("./plain.cjs").exports = { value: "stored" };
  say("a CommonJS file:", require("./plain.cjs").value, cjs.value);
  delete require.cache[require.resolve("./data.json")];
  say("the data file, taken out:", require("./data.json").value);
});
`,
};

async function runTests(directory: string, words: string | undefined, ...flags: string[]) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  if (exitCode !== 0) console.error(stderr);
  return { stdout: stdout.split("\n").filter(line => line.startsWith("SEEN")), exitCode };
}

for (const [way, words] of [
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
]) {
  test(`require() answers what the program has stored in the entry of the file, ${way}`, async () => {
    using dir = tempDir("aot-store-into-an-entry-of-require-cache", files);
    const plain = await runTests(String(dir), undefined);
    expect(plain).toEqual({
      stdout: [
        "SEEN a data file, before: true 1",
        "SEEN a data file: stored 1 true",
        "SEEN an object of another shape: of another shape 2",
        "SEEN a number: 7 undefined 3",
        "SEEN an ES module: stored in place of a module esm true",
        "SEEN members read where the module is required: stored 2 of the stored stored esm 1 of the module",
        "SEEN by a pattern: stored 2",
        "SEEN an ES module that is taken out later: stored evicted",
        "SEEN taken out: evicted",
        "SEEN a CommonJS file: stored cjs",
        "SEEN the data file, taken out: 1",
      ],
      exitCode: 0,
    });
    expect(await runTests(String(dir), words, "--aot")).toEqual(plain);
  }, 180_000);
}
