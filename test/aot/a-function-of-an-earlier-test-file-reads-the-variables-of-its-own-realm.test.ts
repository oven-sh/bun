import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
// One by one: the runner gives this file a process of its own and eight cases at once, beside two more like it: too many builds for four cores.
import { testOneByOne as test } from "./supported";

// `bun test --isolate` gives each test file a fresh realm of one VM, and each realm runs an instance of the compiled program of its own.
// `Bun.s3` is one object for the VM, so what a file hangs on it is there for the next file, in plain Bun too. A native addon that keeps a reference carries values the same way.
// A run that is compiled as one program was compiled for one instance: a call entered the code of the earlier file's function with the instance of the later file,
// which read variables of a module that the later file had never loaded, and crashed.
const files: Record<string, string> = {
  "package.json": `{}`,
  "only-a.mjs": `const table = { x: 1, y: [1, 2, 3] };
let text = "abc".repeat(2);
let total = 0.5;
class Counter { n = 7; next() { return ++this.n; } }
const counter = new Counter();
export const read = () => table.y.length + table.x + text.length;
export const add = () => (total += 1.25);
export const next = () => counter.next();
`,
  "shared.mjs": `export let count = 0;
export function bump() { return ++count; }
`,
  "a.test.mjs": `import { test } from "bun:test";
import { read, add, next } from "./only-a.mjs";
import { bump } from "./shared.mjs";
test("a", () => {
  console.log("SEEN a:", read(), add(), next(), bump());
  Bun.s3.kept = { read, add, next, bump };
});
`,
  "b.test.mjs": `import { test } from "bun:test";
import { bump } from "./shared.mjs";
test("b", () => {
  const kept = Bun.s3.kept;
  console.log("SEEN b, variables of a module that this file never loaded:", kept.read(), kept.add(), kept.next());
  console.log("SEEN b, a variable that both files have:", kept.bump(), kept.bump(), bump());
});
`,
};

async function runTests(directory: string, words: string | undefined, ...flags: string[]) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const command = [bunExe(), "test", "--isolate", ...flags, "./a.test.mjs", "./b.test.mjs"];
  const { stdout, stderr, exitCode } = await run(command, directory, env);
  if (exitCode !== 0) console.error(stderr);
  return { stdout: stdout.split("\n").filter(line => line.startsWith("SEEN")), exitCode };
}

for (const [way, words] of [
  ["as the runner divides it", undefined],
  ["as one program", "TestRunLayers:0"],
  ["over two layers, both files in one process", "TestRunLayers:2,TestRunPartFiles:3"],
] as const) {
  test(`a function of an earlier test file reads the variables of its own realm, ${way}`, async () => {
    using dir = tempDir("aot-a-function-of-an-earlier-test-file", files);
    const plain = await runTests(String(dir), undefined);
    expect(plain).toEqual({
      stdout: [
        "SEEN a: 10 1.75 8 1",
        "SEEN b, variables of a module that this file never loaded: 10 3 9",
        "SEEN b, a variable that both files have: 2 3 1",
      ],
      exitCode: 0,
    });
    expect(await runTests(String(dir), words, "--aot")).toEqual(plain);
  }, 180_000);
}
