import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const files: Record<string, string> = {
  "package.json": `{ "name": "missing-exports-and-imports" }`,
  "file.cjs": `exports.a = 1;\n`,
  "star.mjs": `export * from "./file.cjs";\n`,
  "other-star.mjs": `export * from "./file.cjs";\n`,
  "import-in-front.mjs": `import { imported } from "./star.mjs";\nexport { exported } from "./star.mjs";\nconsole.log(imported);\n`,
  "export-in-front.mjs": `export { exported } from "./star.mjs";\nimport { imported } from "./star.mjs";\nconsole.log(imported);\n`,
  "two-modules.mjs": `import { imported } from "./star.mjs";\nexport { exported } from "./other-star.mjs";\nconsole.log(imported);\n`,
  "renamed.mjs": `import { imported } from "./star.mjs";\nexport { exported as renamed } from "./star.mjs";\nconsole.log(imported);\n`,
  "imported-then-exported.mjs": `import { imported, handedOn } from "./star.mjs";\nexport { handedOn as exported };\nconsole.log(imported);\n`,
  "without-a-star.mjs": `import { imported } from "./file.cjs";\nexport { exported } from "./file.cjs";\nconsole.log(imported);\n`,
  "export-alone.mjs": `export { exported } from "./star.mjs";\n`,
  "chain.mjs": `import { imported } from "./star.mjs";\nexport { exported } from "./export-alone.mjs";\nconsole.log(imported);\n`,
  "export-found.mjs": `import { imported } from "./star.mjs";\nexport { a } from "./star.mjs";\nconsole.log(imported);\n`,
  "both-found.mjs": `import { a } from "./star.mjs";\nexport { a as b } from "./star.mjs";\nexport const c = a + 1;\n`,
  "mocked.cjs": `exports.a = 1;\nexports.kept = 2;\n`,
  "mocked-star.mjs": `export * from "./mocked.cjs";\n`,
  "left-out.mjs": `export { a } from "./mocked-star.mjs";\n`,
  "left-out-behind-an-import.mjs": `import { alsoLeftOut } from "./mocked-star.mjs";\nexport { a } from "./mocked-star.mjs";\nconsole.log(alsoLeftOut);\n`,
  "added.mjs": `export { added, kept } from "./mocked-star.mjs";\n`,
  "loads.test.mjs": `import { mock, test } from "bun:test";
const say = async (label, load) => {
  let said;
  try {
    said = "loaded " + Object.entries(await load()).join(" ");
  } catch (error) {
    said = error.name + " " + String(error.message).replace(/'[^']*\\/([^\\/']+)'/g, "'$1'");
  }
  console.log(label, "|", said);
};
if (process.env.NOBODY_SETS_THIS) mock.module("./file.cjs", () => ({ a: 2 }));
await say("the import stands in front", () => import("./import-in-front.mjs"));
await say("the same module once more", () => import("./import-in-front.mjs"));
await say("the export stands in front", () => import("./export-in-front.mjs"));
await say("each from a module of its own", () => import("./two-modules.mjs"));
await say("exported under another name", () => import("./renamed.mjs"));
await say("imported, then exported", () => import("./imported-then-exported.mjs"));
await say("of the file itself", () => import("./without-a-star.mjs"));
await say("the export alone", () => import("./export-alone.mjs"));
await say("a module further down lacks it", () => import("./chain.mjs"));
await say("the export is found", () => import("./export-found.mjs"));
await say("both are found", () => import("./both-found.mjs"));
mock.module("./mocked.cjs", () => ({ kept: "the mock's", added: 3 }));
await say("a mock leaves the name out", () => import("./left-out.mjs"));
await say("a mock leaves both out", () => import("./left-out-behind-an-import.mjs"));
await say("a mock adds the name", () => import("./added.mjs"));
test("ran", () => {});
`,
};

test("it says what plain Bun says, as one program and in layers", async () => {
  using dir = tempDir("aot-missing-export-before-missing-import", files);
  const directory = String(dir);
  const said = async (flags: string[], words: string) => {
    const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_TMPDIR: directory };
    const ran = await run([bunExe(), "test", ...flags], directory, env);
    return {
      lines: ran.stdout.split("\n").filter(line => line.includes(" | ")),
      summary: ran.stderr.split("\n").filter(line => /^ *\d+ (pass|fail)$/.test(line)),
    };
  };
  const plain = await said([], "");
  expect(plain.summary).toEqual([" 1 pass", " 0 fail"]);
  expect(plain.lines.length).toBe(14);
  expect(plain.lines).toContain("the import stands in front | SyntaxError export 'exported' not found in 'star.mjs'");
  expect(plain.lines).toContain(
    "the export is found | SyntaxError Export named 'imported' not found in module 'star.mjs'.",
  );
  expect(plain.lines).toContain("a mock adds the name | loaded added,3 kept,the mock's");
  expect(plain.lines).toContain("a mock leaves the name out | loaded a,");
  expect(plain.lines).toContain("a mock leaves both out | loaded a,");
  expect(await said(["--aot"], "TestRunLayers:0")).toEqual(plain);
  expect(await said(["--aot"], "TestRunLayers:2,TestRunPartFiles:1")).toEqual(plain);
}, 240_000);
