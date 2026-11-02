import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `import path from "package/library.js" with { type: "file" }`: in a layered test run the layer of the packages holds library.js as code, because other code imports it so.
// Whoever asks for its path or its text gets that, and not what the code exports.
const files: Record<string, string> = {
  "node_modules/shared/package.json": `{ "name": "shared", "version": "1.0.0", "type": "module" }`,
  "node_modules/shared/library.cjs": `module.exports = function Library() {};\n`,
  "node_modules/shared/other.js": `export default function other() {}\n`,
  "src/own.js": `export const own = "own";\n`,
  "src/assets.ts": `
    import pathOfLibrary from "shared/library.cjs" with { type: "file" };
    import Library from "shared/library.cjs";
    import textOfOther from "shared/other.js" with { type: "text" };
    import textOfOwn from "./own.js" with { type: "text" };
    import { own } from "./own.js";
    export const seen = [typeof pathOfLibrary, String(pathOfLibrary).endsWith("library.cjs"), typeof Library, String(textOfOther).trim(), String(textOfOwn).trim(), own].join(" | ");`,
  "assets.test.ts": `
    import { test } from "bun:test";
    import { seen } from "./src/assets";
    import pathHere from "shared/library.cjs" with { type: "file" };
    import LibraryHere from "shared/library.cjs";
    import textOfOwnHere from "./src/own.js" with { type: "text" };
    import other from "shared/other.js";
    test("assets", async () => {
      const later = await import("shared/other.js", { with: { type: "text" } });
      const code = await import("shared/library.cjs");
      console.log("RESULT in the program: " + seen);
      console.log("RESULT in the test file: " + [typeof pathHere, typeof LibraryHere, String(textOfOwnHere).trim(), typeof other, String(later.default).trim(), typeof code.default].join(" | "));
    });`,
};
// A run of few files is one program.
for (let i = 0; i < 17; i++)
  files[`filler${i}.test.ts`] = `import { test } from "bun:test";\ntest("filler ${i}", () => {});\n`;

async function seenIn(words: string | undefined, ...flags: string[]) {
  using dir = tempDir("aot-assets-in-layers", files);
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], String(dir), env);
  const seen = stdout.split("\n").filter(line => line.startsWith("RESULT"));
  return { seen, failed: stderr.split("\n").filter(line => /^\(fail\)|^✗|^panic/.test(line)), exitCode };
}

test("in one program, over one shared image and in two layers as in plain bun test", async () => {
  const [plain, one, shared, layers] = await Promise.all([
    seenIn(undefined),
    seenIn("TestRunLayers:0", "--aot"),
    seenIn("TestRunLayers:1", "--aot"),
    seenIn("TestRunLayers:2", "--aot"),
  ]);
  expect(plain).toEqual({
    seen: [
      `RESULT in the program: string | true | function | export default function other() {} | export const own = "own"; | own`,
      `RESULT in the test file: string | function | export const own = "own"; | function | export default function other() {} | function`,
    ],
    failed: [],
    exitCode: 0,
  });
  expect(one).toEqual(plain);
  expect(shared).toEqual(plain);
  expect(layers).toEqual(plain);
}, 240_000);

// Imported as a file and in no other way, it is no code of the run. A vendored bundle of 3 MB was compiled in the layer of the packages for this, and spoke for what the test run
// replaces. So the file here is no program at all: a build that takes it up reports it.
test("a file that is only imported as a file or a text is compiled by no layer", async () => {
  const onlyData: Record<string, string> = {
    "node_modules/vendored/package.json": `{ "name": "vendored", "version": "1.0.0" }`,
    "node_modules/vendored/dist/bundle.min.js": `this is no program (\n`,
    "node_modules/vendored/dist/also.min.js": `neither is this (\n`,
    "node_modules/vendored/dist/third.min.js": `nor this (\n`,
    "src/assets.ts": `
      import { readFileSync } from "node:fs";
      import pathOfBundle from "vendored/dist/bundle.min.js" with { type: "file" };
      import textOfAlso from 'vendored/dist/also.min.js' with { type: 'text' };
      export const read = () => [readFileSync(pathOfBundle, "utf8").trim(), String(textOfAlso).trim()].join(" | ");`,
    "assets.test.ts": `
      import { test } from "bun:test";
      import { read } from "./src/assets";
      test("assets", async () => {
        const third = await import("vendored/dist/third.min.js", { with: { type: "text" } });
        console.log("RESULT " + read() + " | " + String(third.default).trim());
      });`,
  };
  for (let i = 0; i < 17; i++)
    onlyData[`filler${i}.test.ts`] = `import { test } from "bun:test";\ntest("filler ${i}", () => {});\n`;
  async function seen(words: string | undefined, ...flags: string[]) {
    using dir = tempDir("aot-only-data-in-layers", onlyData);
    const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], String(dir), env);
    const said = stdout.split("\n").filter(line => line.startsWith("RESULT"));
    return { said, failed: stderr.split("\n").filter(line => /^\(fail\)|^✗|^panic|^error/.test(line)), exitCode };
  }
  const plain = await seen(undefined);
  expect(plain).toEqual({
    said: ["RESULT this is no program ( | neither is this ( | nor this ("],
    failed: [],
    exitCode: 0,
  });
  expect(await seen("TestRunLayers:2", "--aot")).toEqual(plain);
}, 240_000);

// `import type` is gone when the file runs. The packages here have declarations, and a main file that is no program: a build that takes one up reports it.
test("a package that is imported for its types alone is compiled by no layer", async () => {
  const typesAlone: Record<string, string> = {
    "tsconfig.json": `{ "compilerOptions": { "module": "esnext", "moduleResolution": "bundler", "strict": true } }`,
    "src/shapes.ts": `
      import type Whole from "types-by-default";
      import type { Side } from "types-by-name";
      import type {
        Corner,
        Edge,
      } from "types-over-lines";
      import type * as All from "types-by-star";
      export type { Handed } from "types-handed-on";
      export type * from "types-all-handed-on";
      import type from "a-value-called-type";
      export function describe(side: Side, corner?: Corner, edge?: Edge, whole?: Whole, all?: All.One): string {
        return [side.length, corner, edge, whole, all, type()].join(" ");
      }`,
    "shapes.test.ts": `
      import { test } from "bun:test";
      import { describe } from "./src/shapes";
      test("shapes", () => {
        console.log("RESULT " + describe({ length: 3 }));
      });`,
    "node_modules/a-value-called-type/package.json": `{ "name": "a-value-called-type", "version": "1.0.0", "type": "module", "main": "index.js" }`,
    "node_modules/a-value-called-type/index.js": `export default function type() { return "a value"; }\n`,
    "node_modules/a-value-called-type/index.d.ts": `export default function type(): string;\n`,
  };
  const declarations: Record<string, string> = {
    "types-by-default": `type Whole = number; export default Whole;`,
    "types-by-name": `export type Side = { length: number };`,
    "types-over-lines": `export type Corner = number; export type Edge = number;`,
    "types-by-star": `export type One = number;`,
    "types-handed-on": `export type Handed = number;`,
    "types-all-handed-on": `export type Other = number;`,
  };
  for (const [name, text] of Object.entries(declarations)) {
    typesAlone[`node_modules/${name}/package.json`] =
      `{ "name": "${name}", "version": "1.0.0", "main": "index.js", "types": "index.d.ts" }`;
    typesAlone[`node_modules/${name}/index.js`] = `this is no program (\n`;
    typesAlone[`node_modules/${name}/index.d.ts`] = text + "\n";
  }
  for (let i = 0; i < 17; i++)
    typesAlone[`filler${i}.test.ts`] = `import { test } from "bun:test";\ntest("filler ${i}", () => {});\n`;
  async function seen(words: string | undefined, ...flags: string[]) {
    using dir = tempDir("aot-types-alone-in-layers", typesAlone);
    const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], String(dir), env);
    const said = stdout.split("\n").filter(line => line.startsWith("RESULT"));
    return { said, failed: stderr.split("\n").filter(line => /^\(fail\)|^✗|^panic|^error/.test(line)), exitCode };
  }
  const plain = await seen(undefined);
  expect(plain).toEqual({ said: ["RESULT 3     a value"], failed: [], exitCode: 0 });
  expect(await seen("TestRunLayers:2", "--aot")).toEqual(plain);
}, 240_000);
