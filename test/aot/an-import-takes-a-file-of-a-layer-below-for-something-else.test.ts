import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// shared.test.js imports the helpers as code, so the layer that the test files share holds them as code.
const helpers = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "tsconfig.json": `{ "compilerOptions": { "allowJs": true, "resolveJsonModule": true } }`,
  "helpers/named.js": `export const name = "named";`,
  "helpers/bundle.js": `export default function start() { return "ran"; }`,
  "helpers/data.json": `{ "name": "data" }`,
  "shared.test.js": `
    import { test } from "bun:test";
    import "./helpers/named.js";
    import start from "./helpers/bundle.js";
    import data from "./helpers/data.json";
    test("shared", () => { console.log(start(), data.name); });`,
  "third.test.js": `import { test } from "bun:test";\ntest("third", () => {});`,
};

async function expectCompiledToRunAsPlain(testFile: string) {
  using dir = tempDir("an-import-takes-a-file-for-something-else", { ...helpers, "asks.test.js": testFile });
  const seen = async (words?: string, ...flags: string[]) => {
    const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], String(dir), env);
    if (exitCode !== 0) console.error(stderr);
    // The parts of a run end in any order.
    return { lines: stdout.split("\n").sort(), exitCode };
  };
  const plain = await seen();
  expect(plain.exitCode).toBe(0);
  expect(plain.lines.filter(line => line.startsWith("asked"))).toHaveLength(1);
  for (const words of [undefined, "TestRunLayers:2,TestRunPartFiles:1", "TestRunLayers:1,TestRunPartFiles:1"])
    expect(await seen(words, "--aot")).toEqual(plain);
}

test("the text of a file without a default export", async () => {
  await expectCompiledToRunAsPlain(`
    import { test } from "bun:test";
    import text from "./helpers/named.js" with { type: "text" };
    test("asks", () => { console.log("asked", typeof text, text); });`);
});

test("the text of a file whose default export is a function", async () => {
  await expectCompiledToRunAsPlain(`
    import { test } from "bun:test";
    import text from "./helpers/bundle.js" with { type: "text" };
    test("asks", () => { console.log("asked", typeof text, text.startsWith("export default")); });`);
});

test("the path of a file", async () => {
  await expectCompiledToRunAsPlain(`
    import { test } from "bun:test";
    import path from "./helpers/bundle.js" with { type: "file" };
    test("asks", () => { console.log("asked", typeof path, String(path).endsWith("bundle.js")); });`);
});

test("the code and the text of one file", async () => {
  await expectCompiledToRunAsPlain(`
    import { test } from "bun:test";
    import start from "./helpers/bundle.js";
    import text from "./helpers/bundle.js" with { type: "text" };
    test("asks", async () => {
      const again = await import("./helpers/bundle.js", { with: { type: "text" } });
      console.log("asked", start(), typeof text, again.default === text);
    });`);
});

test("a file taken for what its name says is the module of the layer", async () => {
  await expectCompiledToRunAsPlain(`
    import { test } from "bun:test";
    import data from "./helpers/data.json" with { type: "json" };
    import plainly from "./helpers/data.json";
    import text from "./helpers/data.json" with { type: "text" };
    test("asks", () => { console.log("asked", data.name, data === plainly, typeof text); });`);
});
