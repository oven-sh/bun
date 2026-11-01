// `bun test` has two loaders. The one behind `require` takes a file named .cjs for CommonJS. The one behind `import` asks only for the "type" of the package, so a .cjs file
// whose text does not say what it is (a script that only has side effects) is an ES module where imports alone load it: strict, and evaluated in the order of the modules,
// behind the CommonJS files beside it. A run that is built in layers does not see, while it builds a layer, the files above that load the layer's entry points. It took
// each such entry point for required: sloppy, and evaluated in another order.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const says = (name: string) => `
  function mode() { return (function () { return this === undefined ? "strict" : "sloppy"; })(); }
  console.error("OUT ${name}", mode(), (() => { try { globalThis.undefined = 1; return "no throw"; } catch (e) { return e.constructor.name; } })());`;
const files = {
  "bare.cjs": says("bare.cjs"),
  "uses.cjs": says("uses.cjs") + "\nexports.used = true;",
  "node_modules/pkg/package.json": `{ "name": "pkg" }`,
  "node_modules/pkg/side.cjs": says("pkg/side.cjs"),
  "node_modules/pkg/index.cjs": says("pkg/index.cjs") + "\nexports.used = true;",
  "project.ts": `import "pkg/side.cjs";\nimport "pkg/index.cjs";\nexport const project = 1;`,
};
const testFiles = {
  "a statement": `import { test } from "bun:test";\nimport "./bare.cjs";\nimport "./uses.cjs";\ntest("t", () => {});`,
  "import()": `import { test } from "bun:test";\ntest("t", async () => { await import("./bare.cjs"); await import("./uses.cjs"); });`,
  "require": `const { test } = require("bun:test");\ntest("t", () => { require("./bare.cjs"); require("./uses.cjs"); });`,
  "a file of the project imports a package": `import { test } from "bun:test";\nimport "./project.ts";\ntest("t", () => {});`,
};

async function linesOf(testFile: string, isCommonJS: boolean, flags: string[], words?: string) {
  using dir = tempDir("aot-one-format-over-layers", { ...files, [isCommonJS ? "a.test.cjs" : "a.test.ts"]: testFile });
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  await using run = Bun.spawn({
    cmd: [bunExe(), "test", ...flags, "--isolate"],
    cwd: String(dir),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([run.stderr.text(), run.exited]);
  return { lines: stderr.split("\n").filter(line => line.startsWith("OUT")), exitCode };
}

test.concurrent.each(Object.entries(testFiles))(
  "loaded by %s",
  async (name, testFile) => {
    const plain = await linesOf(testFile, name === "require", []);
    expect(plain.lines.length).toBe(2);
    expect(await linesOf(testFile, name === "require", ["--aot"])).toEqual(plain);
    expect(await linesOf(testFile, name === "require", ["--aot"], "TestRunLayers:2")).toEqual(plain);
  },
  240_000,
);
