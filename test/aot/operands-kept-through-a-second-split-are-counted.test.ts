// The register allocator may split a live range into a cluster over several blocks and, when that finds no register, split the cluster again.
// An operand that a call only reads (a cold use) has to take the name of the second cluster with the other mentions. A build counts those that did:
//   ColdUsesKeptThroughSecondSplit             left behind they would read the value's stack slot. Where it is 0 the second split had nothing to find
//   ColdUsesKeptThroughSecondSplitBetweenDefs  those of them that stand between two writes of the value, where the slot does not hold it yet
// and the functions that hold any. They are counted where the operand takes the name, whatever becomes of the cluster.
// BUN_JSC_airDumpPhaseStats=1 in the environment of the build names the functions.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { built, spawned } from "./harness/commands";
import { compileCommand } from "./harness/flags";
import { test } from "./supported";

const env = { ...bunEnv, NO_COLOR: "1" };
const names = [
  "ColdUsesKeptThroughSecondSplit",
  "FunctionsWithColdUsesKeptThroughSecondSplit",
  "ColdUsesKeptThroughSecondSplitBetweenDefs",
  "FunctionsWithColdUsesKeptThroughSecondSplitBetweenDefs",
];

async function countsOf(file: string, more: Record<string, string> = {}) {
  using dir = tempDir("aot-operands-kept-through-a-second-split", {});
  const executable = join(String(dir), isWindows ? "app.exe" : "app");
  const build = await spawned(
    [bunExe(), ...compileCommand, "--explain=statistics", file, "--outfile", executable],
    String(dir),
    { ...env, ...more },
  );
  built(build);
  const output = build.stdout + build.stderr;
  return { output, counts: names.map(name => new RegExp(`^${name} (\\d+)$`, "m").exec(output)?.[1]).map(Number) };
}

const stored = (name: string, folder = "mistyped-values") => join(import.meta.dir, "parallel", folder, name);

test("a program that prints a line holds no such place", async () => {
  using dir = tempDir("aot-operands-kept-hello", { "hello.ts": `console.log("hello");` });
  expect((await countsOf(join(String(dir), "hello.ts"))).counts).toEqual([0, 0, 0, 0]);
}, 300_000);

// How many registers outlive a call goes by the processor: these two functions run out of them on x64.
test.each(["function-typed-boolean-read-from-record-by-inherited-name.ts", "function-typed-boolean-through-any.ts"])(
  "%s holds one, between two writes",
  async name => {
    const { counts } = await countsOf(stored(name));
    if (process.arch === "x64") expect(counts).toEqual([1, 1, 1, 1]);
    else expect(counts.every(count => count >= 0)).toBe(true);
  },
  300_000,
);

test.skipIf(process.arch !== "x64")(
  "the function is named on request",
  async () => {
    const { output } = await countsOf(stored("function-typed-boolean-through-any.ts"), {
      BUN_JSC_airDumpPhaseStats: "1",
    });
    expect(output).toMatch(
      /^cold uses kept through a second split: 1, between two defs: 1, in f\d+ f \(.*function-typed-boolean-through-any\.ts:\d+\)$/m,
    );
  },
  300_000,
);

// The body of a module has no name. If this program holds no such place any more, take another whose line has two blanks behind the number of the function.
// Ask a Bun with assertions too: it puts checks into the code that it generates, six times the bytes, so its allocator splits in other places.
test.skipIf(process.arch !== "x64")(
  "a function without a name is named by its file",
  async () => {
    const { output } = await countsOf(stored("array-from-of-a-set-with-a-mapper.js", "builtins"), {
      BUN_JSC_airDumpPhaseStats: "1",
    });
    expect(output).toMatch(
      /^cold uses kept through a second split: \d+, between two defs: 0, in f\d+  \(.*array-from-of-a-set-with-a-mapper\.js:1\)$/m,
    );
  },
  300_000,
);
