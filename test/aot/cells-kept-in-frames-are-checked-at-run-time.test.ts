import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { withoutCoreDump, withoutCrashReport } from "./harness/commands";
import { run as spawned } from "./harness/run";
import { describe, test } from "./supported";

// The compiler keeps an object or a closure in the frame of the function that makes it where it has proven that nothing holds it once the function is left.
// --aot-testing=CheckProofsAtRunTime builds the product's code and holds a run against that proof: whoever reads or writes such a cell behind the end of its frame stops,
// and the stop names the allocation. These tests plant false proofs to see that it finds them: --aot-sabotage=CellsThatAreKeptLieInFrames makes the compiler keep cells
// in frames whoever holds them. ./engine-tests/validation/cells-kept-in-frames has the ways out of a function and the ways to hold a cell that need no more than the language.
const checked = "--aot-testing=CheckProofsAtRunTime";
const planted = "--aot-sabotage=CellsThatAreKeptLieInFrames";
// A function that is copied into its caller has no frame to leave.
const apart = "--aot-disable=pass:InlineCalls,pass:InlineHeads";

const head = `type Point = { x: number; y: number };
const turns = process.argv.length > 99 ? 5 : 3;
// Other frames come to lie where the frame that was left lay.
function fill(depth: number): number {
  return depth > 0 ? fill(depth - 1) + depth : turns;
}
let sum = 0;
`;

/** `kept` stands in front of the allocation that the stop must name. */
const programs: Record<string, { text: string; printed: string }> = {
  "an object handed to a timer": {
    text: `function later(p: Point): void {
  sum += p.x * 10 + p.y;
}
function keep(a: number): void {
  setTimeout(later, 0, /* kept */ { x: a, y: a + 1 });
}
for (let i = 0; i < turns; i++) keep(i);
sum += fill(8);
setTimeout(() => console.log(sum), 5);
`,
    printed: "75\n",
  },
  "a closure handed to a timer": {
    text: `function keep(a: number): void {
  setTimeout(/* kept */ () => {
    sum += a * 10;
  }, 0);
}
for (let i = 0; i < turns; i++) keep(i);
sum += fill(8);
setTimeout(() => console.log(sum), 5);
`,
    printed: "69\n",
  },
  "an object that a promise is resolved with": {
    text: `async function keep(a: number): Promise<Point> {
  return /* kept */ { x: a, y: a + 1 };
}
for (let i = 0; i < turns; i++) {
  const p = await keep(i);
  sum += fill(8);
  sum += p.x * 10 + p.y;
}
console.log(sum);
`,
    printed: "153\n",
  },
};

function positionOfAllocation(text: string) {
  const before = text.slice(0, text.indexOf("/* kept */ ") + "/* kept */ ".length).split("\n");
  return `${before.length}:${before.at(-1)!.length + 1}`;
}

async function buildAndRun(cwd: string, name: string, flags: string[]) {
  const built = await spawned(
    [bunExe(), "build", "--compile", "--aot", apart, ...flags, "program.ts", "--outfile", name],
    cwd,
  );
  expect(built.stderr).not.toContain("error:");
  expect(built.exitCode).toBe(0);
  return spawned(withoutCoreDump([join(cwd, name)]), cwd, { ...bunEnv, ...withoutCrashReport });
}

// The range in which the cells lie is reserved with the system calls of POSIX.
describe.skipIf(isWindows).concurrent.each(Object.entries(programs))("%s", (_, { text, printed }) => {
  test("is as in plain Bun in a build that checks its proofs", async () => {
    using folder = tempDir("aot-cells-kept-in-frames", { "program.ts": head + text });
    const { stdout, stderr, exitCode } = await buildAndRun(String(folder), "checked", [checked]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: printed, stderr: "", exitCode: 0 });
  }, 120_000);

  test("is a stop that names the allocation once cells lie in frames whoever holds them", async () => {
    using folder = tempDir("aot-cells-kept-in-frames", { "program.ts": head + text });
    const { stdout, stderr, exitCode } = await buildAndRun(String(folder), "planted", [checked, planted]);
    expect(stderr).toMatch(/^AOT validation: EscapedFrameCell f\d+ v\d+, .*$/m);
    expect(/^AOT validation: EscapedFrameCell f\d+ v\d+, (.*)$/m.exec(stderr)![1]).toEndWith(
      `program.ts:${positionOfAllocation(head + text)}`,
    );
    expect(stdout).toBe("");
    expect(exitCode).not.toBe(0);
  }, 120_000);
});
