// `--aot-check=spill-slots` (hidden; --aot-validate includes it) holds the register allocator to this: every read of a spill slot sees the value that the slot stands for, on
// every path from the entry of the function. Going back from the read, the first thing met has to be a write of the slot. It is an error to meet the entry (nothing has written
// it) or an instruction that computes the value anew into a register (nothing has stored it). The check generates no code and changes none.
// `--aot-sabotage=LiveRangesSplitTwiceHaveNoColdUses` brings back the fault that it was written for: the operand of a call was left reading such a slot.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { built, spawned } from "./harness/commands";
import { compileCommand } from "./harness/flags";
import { test } from "./supported";

const env = { ...bunEnv, NO_COLOR: "1" };
const programs = [
  "function-typed-boolean-read-from-record-by-inherited-name.ts",
  "function-typed-boolean-through-any.ts",
  "function-typed-boolean-printed-twice.ts",
];
const stored = (name: string) => join(import.meta.dir, "parallel", "mistyped-values", name);

async function build(name: string, flags: string[]) {
  const dir = tempDir("aot-spill-slots", {});
  const executable = join(String(dir), isWindows ? "app.exe" : "app");
  const result = await spawned(
    [bunExe(), ...compileCommand, ...flags, stored(name), "--outfile", executable],
    String(dir),
    env,
  );
  return { dir, executable, result };
}

test.each(programs)(
  "%s passes the check and runs as plain Bun runs it",
  async name => {
    const { dir, executable, result } = await build(name, ["--aot-check=spill-slots"]);
    using _ = dir;
    built(result);
    const plain = await spawned([bunExe(), stored(name)], String(dir), env);
    expect(plain.exitCode).toBe(0);
    expect(await spawned([executable], String(dir), env)).toEqual(plain);
  },
  300_000,
);

// How many registers outlive a call goes by the processor: these functions run out of them on x64.
test.skipIf(process.arch !== "x64").each(programs)(
  "%s: with the fault back, the check names the function, the slot, the call and the path",
  async name => {
    const { dir, result } = await build(name, [
      "--aot-check=spill-slots",
      "--aot-sabotage=LiveRangesSplitTwiceHaveNoColdUses",
    ]);
    using _ = dir;
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(
      /internal compiler error \(GenerateCode\): SpillSlotLacksItsValue: 'f' \(f\d+\): a spill slot is read at v\d+ \(ToString\) where it does not hold its value; behind register allocation: spill\d+, bytes 0 to 3, is read by `Patch [^`]*\(spill\d+\)` \(#0, instruction \d+\), but `Move [^`]*` \(#0, instruction 0\) has changed the value it stands for, and nothing stores it on the path #0 /,
    );
  },
  300_000,
);
