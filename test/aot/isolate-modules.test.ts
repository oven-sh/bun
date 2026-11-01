// `bun test --isolate=modules` gives each test file a module graph of its own in one global object, whose properties it puts back between files. Under `--aot` such a run ended
// before its first file, with exit code 1 and not a word: the function that puts the globals back is the runner's own library code, which a compiled run does not load.
// Over layers the lowest layer holds it, and the run is as plain's. In one program each file gets a global object of its own, as under `--isolate`:
// what hangs on `process.versions` or on a built-in module is then gone too: test/aot/isolate-doors.test.ts.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const file = (name: string) => `import { expect, test } from "bun:test";
import { mainOfShared, state } from "./shared.js";
test("${name}", () => {
  console.log("SEEN ${name}", state.loads, ++state.uses, typeof globalThis.left, typeof Array.prototype.left, process.env.LEFT);
  // The files share one \`process\`, and the runner lays a new list over both between files.
  console.log("SEEN ${name} as", [process.argv[1], Bun.argv[1], mainOfShared()].map(path => path.split(/[\\\\/]/).pop()).join());
  globalThis.left = 1;
  Array.prototype.left = 1;
  process.env.LEFT = "1";
  expect(1).toBe(1);
});
`;
const files = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "preload.js": `globalThis.preloads = (globalThis.preloads ?? 0) + 1;\nconsole.log("SEEN the preload", globalThis.preloads);\n`,
  "shared.js": `console.log("SEEN shared.js loads");\nexport const state = { loads: 1, uses: 0 };\nexport const mainOfShared = () => process.argv[1];\n`,
  "a.test.js": file("a"),
  "b.test.js": file("b"),
  "c.test.js": file("c"),
};

async function runTests(directory: string, words: string | undefined, ...flags: string[]) {
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
  const command = [bunExe(), "test", "--isolate=modules", "--preload=./preload.js", ...flags];
  const { stdout, stderr, exitCode } = await run(command, directory, env);
  return {
    stdout: stdout.split("\n").filter(line => line.startsWith("SEEN")),
    results: [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`),
    exitCode,
  };
}

test("--isolate=modules runs, and a file sees nothing of the file before it", async () => {
  using dir = tempDir("aot-isolate-modules", files);
  const plain = await runTests(String(dir), undefined);
  const of = (name: string) => [
    "SEEN the preload 1",
    "SEEN shared.js loads",
    `SEEN ${name} 1 1 undefined undefined undefined`,
    `SEEN ${name} as ${name}.test.js,${name}.test.js,${name}.test.js`,
  ];
  expect(plain).toEqual({
    stdout: [...of("a"), ...of("b"), ...of("c")],
    results: ["pass a", "pass b", "pass c"],
    exitCode: 0,
  });
  const [oneProgram, layers] = await Promise.all([
    runTests(String(dir), undefined, "--aot"),
    runTests(String(dir), "TestRunLayers:2", "--aot"),
  ]);
  expect(oneProgram).toEqual(plain);
  expect(layers).toEqual(plain);
}, 240_000);
