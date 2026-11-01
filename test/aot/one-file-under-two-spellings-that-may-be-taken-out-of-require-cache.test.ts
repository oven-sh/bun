import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `import * as math from "./helpers/math.js"; import * as again from "./helpers/../helpers/math.js"`: one file, one module, one namespace object, however it is spelled.
// Where the test file may take the file out of require.cache, the build once left each spelling to the loader of the run time as a module of its own. The loader was asked
// for the file once, so the second spelling found nothing when a test read it: "The module .. is not loaded".
const say = `const say = (name, run) => { try { console.log(name, JSON.stringify(run())); } catch (error) { console.log(name, "threw", error.message); } };`;
const evicts = (path: string) =>
  `test("may take it out", () => { console.log(typeof (() => delete require.cache[require.resolve("${path}")])); });`;
const files = {
  "package.json": `{ "type": "module" }`,
  "tsconfig.json": `{ "compilerOptions": { "allowJs": true, "paths": { "@math": ["./helpers/math.js"] } } }`,
  "helpers/math.js": `export const add = (a, b) => a + b;\nexport let calls = 0;\nexport const count = () => ++calls;\n`,
  "helpers/common.cjs": `exports.name = "common";\nexports.calls = 0;\nexports.count = () => ++exports.calls;\n`,
  "namespaces.test.js": `import { test } from "bun:test";
import * as math from "./helpers/math.js";
import * as again from "./helpers/../helpers/math.js";
${say}
test("namespaces", () => {
  say("the first", () => math.add(1, 2));
  say("the second", () => again.add(1, 2));
  say("one object", () => [again === math, again.add === math.add, math.count(), again.count(), again.calls]);
});
${evicts("./helpers/math.js")}
`,
  "the-odd-one-first.test.js": `import { test } from "bun:test";
import * as again from "./helpers/../helpers/math.js";
import * as math from "./helpers/math.js";
${say}
test("the odd one first", () => {
  say("the first", () => again.add(1, 2));
  say("the second", () => math.add(1, 2));
});
${evicts("./helpers/math.js")}
`,
  "an-alias.test.ts": `import { test } from "bun:test";
import * as math from "./helpers/math.js";
import * as aliased from "@math";
${say}
test("an alias of the tsconfig.json", () => {
  say("by its path", () => math.add(1, 2));
  say("by the alias", () => [aliased.add(1, 2), (aliased as unknown) === math]);
});
${evicts("./helpers/math.js")}
`,
  "names.test.js": `import { test } from "bun:test";
import { add, count } from "./helpers/math.js";
import { add as addAgain, count as countAgain, calls } from "./helpers/../helpers/math.js";
${say}
test("names", () => { say("names", () => [add(1, 2), addAgain(1, 2), add === addAgain, count(), countAgain(), calls]); });
${evicts("./helpers/math.js")}
`,
  "a-commonjs-file.test.js": `import { test } from "bun:test";
import * as common from "./helpers/common.cjs";
import * as again from "./helpers/../helpers/common.cjs";
${say}
test("a CommonJS file", () => {
  say("the first", () => common.name);
  say("the second", () => again.name);
  say("one object", () => [again === common, common.count(), again.count()]);
});
${evicts("./helpers/common.cjs")}
`,
  "taken-out.test.js": `import { test } from "bun:test";
import * as math from "./helpers/math.js";
import * as again from "./helpers/../helpers/math.js";
${say}
test("it is taken out", () => {
  const path = require.resolve("./helpers/math.js");
  say("before", () => [math.count(), again.count()]);
  delete require.cache[path];
  say("behind", () => [math.count(), again.count(), again === math, require(path).calls]);
});
`,
};

async function runTests(directory: string, words: string | undefined, ...flags: string[]) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  if (exitCode !== 0) console.error(stderr);
  return { stdout: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")), exitCode };
}

for (const [way, words] of [
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
]) {
  test(`one file under two spellings is one module, ${way}`, async () => {
    using dir = tempDir("aot-one-file-under-two-spellings", files);
    const plain = await runTests(String(dir), undefined);
    expect(plain.exitCode).toBe(0);
    expect(plain.stdout).toContain("one object [true,true,1,2,2]");
    expect(await runTests(String(dir), words, "--aot")).toEqual(plain);
  }, 120_000);
}
