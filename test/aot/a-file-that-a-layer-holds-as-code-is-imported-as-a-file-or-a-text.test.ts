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
