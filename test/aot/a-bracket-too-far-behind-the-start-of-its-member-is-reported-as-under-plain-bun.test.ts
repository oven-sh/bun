// The tree of Bun's transpiler keeps the `[` of a member in brackets as its distance from the start of the member, in sixteen bits. Its source map has a `[` that starts a line only up to that distance, and an executable reports a frame where that source map has it.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { built, spawned, unsupported, withoutDebugInformation } from "./harness/commands";
import { compileCommand } from "./harness/flags";

/** The farthest that a `[` stands behind the first byte of its member where the tree keeps it. */
const farthest = 65_535;
/** What a row has from the `q` of `quiet()` to its `[`, but for the blanks behind the `)`. */
const around = "quiet()\n    ".length;
/** The same for a row whose member is the key of a method. */
const aroundInAKey = "quiet()\n      ".length;

/** A member of undefined whose `[` starts a line `distance` bytes behind the start of the member. */
const row = (name: string, distance: number) => `
show(function ${name}() {
  quiet()${Buffer.alloc(distance - around, " ").toString()}
    [key()];
});`;

/** The same member as the computed key of a method of a class. */
const rowInAKey = (name: string, distance: number) => `
show(function ${name}() {
  return class {
    [quiet()${Buffer.alloc(distance - aroundInAKey, " ").toString()}
      [key()]]() {}
  };
});`;

const program = `function quiet() {}
const key = () => "k";
function show(run) {
  try {
    run();
    console.log(run.name, "| nothing is thrown");
  } catch (error) {
    const frame = String(error.stack).split("\\n").find(line => line.includes("at " + run.name + " ("));
    console.log(run.name, "|", error.name, "|", /:(\\d+:\\d+)\\)?$/.exec(frame)[1]);
  }
}${row("near", around)}${row("farthest", farthest)}${row("tooFar", farthest + 1)}${rowInAKey("nearInAKey", aroundInAKey)}${rowInAKey("farthestInAKey", farthest)}${rowInAKey("tooFarInAKey", farthest + 1)}
`;

/** The line on which the function of a row begins. Its `quiet()` is on the next line, and its `[` on the one after. A key stands one line further down. */
const lineOf = (name: string) => program.slice(0, program.indexOf(`function ${name}(`)).split("\n").length;

/** The line of the frame that each row printed. */
const linesOf = (stdout: string) =>
  Object.fromEntries(
    [...stdout.matchAll(/^(\w+) \| TypeError \| (\d+):\d+$/gm)].map(([, name, line]) => [name, Number(line)]),
  );

async function ran(cmd: string[], cwd: string) {
  const { stdout, stderr, exitCode } = await spawned(cmd, cwd, bunEnv);
  return { stdout, stderr, exitCode };
}

describe.concurrent("a `[` that starts a line far behind the start of its member", () => {
  test("the frame is at the `[` up to the farthest place that the tree keeps, and in front of it beyond", async () => {
    using dir = tempDir("aot-far-bracket", { "brackets.mjs": program });
    const { stdout, ...ended } = await ran([bunExe(), "./brackets.mjs"], String(dir));
    expect({ lines: linesOf(stdout), ...ended }).toEqual({
      lines: {
        near: lineOf("near") + 2,
        farthest: lineOf("farthest") + 2,
        tooFar: lineOf("tooFar") + 1,
        nearInAKey: lineOf("nearInAKey") + 3,
        farthestInAKey: lineOf("farthestInAKey") + 3,
        tooFarInAKey: lineOf("tooFarInAKey") + 2,
      },
      stderr: "",
      exitCode: 0,
    });
  });

  test.skipIf(!!unsupported)("the executable prints what the program prints", async () => {
    using dir = tempDir("aot-far-bracket", { "brackets.mjs": program });
    const cwd = String(dir);
    const executable = join(cwd, isWindows ? "brackets.exe" : "brackets");
    const build = [...compileCommand, ...withoutDebugInformation(), "./brackets.mjs", "--outfile", executable];
    const [plain, ended] = await Promise.all([
      ran([bunExe(), "./brackets.mjs"], cwd),
      spawned([bunExe(), ...build], cwd, bunEnv),
    ]);
    expect(plain).toEqual({ stdout: expect.stringContaining("tooFar | TypeError | "), stderr: "", exitCode: 0 });
    built(ended);
    expect(await ran([executable], cwd)).toEqual(plain);
  });
});
