import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { eachRow, gap } from "./supported";

// The loader takes what a test file imports level by level, and a CommonJS file runs where the loader comes to it. What stands on its level or below is not loaded by then:
// require() parses the file itself and answers the value. What stands on a level above is loaded, and require() answers the namespace object.
// As test/aot/parallel/modules/a-data-file-required-before-the-loader-comes-to-its-import and its neighbours, under the test runner.
const settings = `{ "host": "localhost", "port": 3000 }
`;
const testFile = `import { expect, test } from "bun:test";
import "./src/early.cjs";
import above from "./above.json";
import beside from "./beside.json";
import "./src/level-1";
test("what require() answered", () => {
  console.log("below:", globalThis.below, "| beside:", globalThis.beside, "| above:", globalThis.above);
  expect(above.port + beside.port).toBe(6000);
});
`;
const files = (early: string): Record<string, string> => ({
  "package.json": `{ "name": "project" }`,
  "tsconfig.json": "{}",
  "above.json": settings,
  "beside.json": settings,
  "src/below.json": settings,
  "src/early.cjs": `${early}
module.exports = 1;
`,
  "src/level-1.ts": `import "./late.cjs";
import "./level-2";
export {};
`,
  "src/late.cjs": `globalThis.above = Object.keys(require("../above.json")).join();
module.exports = 1;
`,
  "src/level-2.ts": `import "./level-3";
export {};
`,
  "src/level-3.ts": `import below from "./below.json";
export const port = below.port;
`,
  "first.test.ts": testFile,
  "second.test.ts": testFile,
});
const below = `globalThis.below = Object.keys(require("./below.json")).join();`;
const beside = `globalThis.beside = Object.keys(require("../beside.json")).join();`;

async function runTests(directory: string, words: string, flags: string[]) {
  // Plain Bun reads the texts as they are asked for. With threads it comes to a file sooner or later, and wavers.
  const env = { ...bunEnv, BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1", BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, env);
  if (exitCode !== 0) console.error(stderr);
  return { printed: stdout.split("\n").filter(line => line.startsWith("below:")), exitCode };
}

const oneProgram = "TestRunLayers:0";
const twoLayers = "TestRunLayers:2,TestRunPartFiles:1";
const askedForIsNotLoaded =
  "over layers the test file and the CommonJS file lie in two images: a file counts as loaded once the loader has asked for it, as in plain Bun with threads";
eachRow([
  ["levels below and a level above", "as one program", "", oneProgram, below, "host,port", "undefined"],
  ["levels below and a level above", "as one program", "--isolate", oneProgram, below, "host,port", "undefined"],
  ["levels below and a level above", "over two layers", "", twoLayers, below, "host,port", "undefined"],
  ["levels below and a level above", "over two layers", "--isolate", twoLayers, below, "host,port", "undefined"],
  ["on the level of the file", "as one program", "", oneProgram, beside, "undefined", "host,port"],
  ["on the level of the file", "as one program", "--isolate", oneProgram, beside, "undefined", "host,port"],
  gap(askedForIsNotLoaded, [
    "on the level of the file",
    "over two layers",
    "",
    twoLayers,
    beside,
    "undefined",
    "host,port",
  ]),
  gap(askedForIsNotLoaded, [
    "on the level of the file",
    "over two layers",
    "--isolate",
    twoLayers,
    beside,
    "undefined",
    "host,port",
  ]),
] as const)(
  "require() of a data file goes by how far the loader has come: %s, %s %s",
  async (_where, _form, flag, words, early, answerBelow, answerBeside) => {
    using dir = tempDir("aot-data-file-required-early", files(early));
    const flags = flag ? [flag] : [];
    const plain = await runTests(String(dir), words, flags);
    const line = `below: ${answerBelow} | beside: ${answerBeside} | above: default,host,port`;
    expect(plain).toEqual({ printed: [line, line], exitCode: 0 });
    expect(await runTests(String(dir), words, ["--aot", ...flags])).toEqual(plain);
  },
  120_000,
);
