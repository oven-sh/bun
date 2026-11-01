// Under --parallel=1 --no-isolate one worker runs every test file and keeps one global object, so what the first file leaves behind is there for the last.
// Over layers the test files were dealt to programs of sixteen, each a process of its own: the seventeenth saw nothing.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { expectLayers } from "./harness/layers";
import { run } from "./harness/run";
import { test } from "./supported";

// A small run takes layers by itself with --parallel and more source than fits the memory it is given: every test file imports 300 KB of filler.
const filler = Array.from({ length: 6000 }, (_, i) => `export function filler${i}(x) { return x + ${i}; }\n`).join("");
const names = Array.from({ length: 18 }, (_, i) => `t${String(i + 1).padStart(2, "0")}`);
const leaves = `globalThis.leftBehind = "a global"; process.leftBehind = "a member"; process.env.LEFT_BEHIND = "a variable";`;
const file = (name: string) => `import { filler1 } from "./filler.mjs"; void filler1;
import { test } from "bun:test";
test("t", () => {
  ${name === names[0] ? leaves : ""}
  console.error("OUT ${name} " + [globalThis.leftBehind, process.leftBehind, process.env.LEFT_BEHIND].join());
});
`;

test("the last of eighteen test files sees what the first left behind", async () => {
  using dir = tempDir("aot-leftovers", {
    "package.json": `{ "name": "p", "type": "module" }`,
    "filler.mjs": filler,
    ...Object.fromEntries(names.map(name => [`${name}.test.js`, file(name)])),
  });
  const seen = async (...flags: string[]) => {
    const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunSaysItsForm" };
    const { stdout, stderr } = await run(
      [bunExe(), "test", "--parallel=1", "--no-isolate", ...flags],
      String(dir),
      env,
    );
    const lines = (stdout + "\n" + stderr).split("\n");
    return { text: lines.join("\n"), said: lines.filter(line => line.startsWith("OUT ")).sort() };
  };
  const plain = await seen();
  expect(plain.said).toEqual(names.map(name => `OUT ${name} a global,a member,a variable`));
  const layers = await seen("--aot", "--aot-memory-limit", "1MB");
  expectLayers(layers.text);
  expect(layers.said).toEqual(plain.said);
}, 240_000);
