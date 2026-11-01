// `bun test --aot --parallel --timings` over layers builds more parts at once than it has workers, and a worker runs a part from its first file to its last.
// A worker took whichever part was ready first. The largest test file is built last and tends to run longest: it waited until a worker had run a whole lesser part, and then it
// ended the run: on a large suite the longest file of a shard began 46 s into the run, as the 26th file of 24 workers.
// A slow file is a part of its own, and a worker is kept for it while it is built.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const quick = (name: string) =>
  `import { test } from "bun:test";\ntest("${name}", () => {\n  console.error("RUNS", "${name}");\n});\n`;
// Its build takes longer than that of the four others together.
const large = `${quick("slow")}${Array.from(
  { length: 1500 },
  (_, index) =>
    `export function f${index}(a: number, b: string[]) { for (const c of b) a += c.length * ${index}; return { a, b: b.map(c => c + a), c: [a, ${index}] }; }`,
).join("\n")}\n`;

test("the slow file runs first, though its part is ready last", async () => {
  using dir = tempDir("aot-a-worker-is-kept-for-the-slow-file", {
    "package.json": `{ "name": "p" }`,
    "slow.test.ts": large,
    ...Object.fromEntries(["a", "b", "c", "d"].map(name => [`${name}.test.ts`, quick(name)])),
    "timings.json": JSON.stringify({
      version: 1,
      files: { "slow.test.ts": 5000, "a.test.ts": 40, "b.test.ts": 30, "c.test.ts": 20, "d.test.ts": 10 },
    }),
  });
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:2" };
  const command = [bunExe(), "test", "--aot", "--parallel=1", "--timings=timings.json"];
  const { stderr, exitCode } = await run(command, String(dir), env);
  expect({ ran: Array.from(stderr.matchAll(/^RUNS (\w+)$/gm), match => match[1]), exitCode }).toEqual({
    ran: ["slow", "a", "b", "c", "d"],
    exitCode: 0,
  });
}, 240_000);
