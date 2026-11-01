// `--aot-check=allocated-registers` (hidden; --aot-validate includes it) holds the register allocator to this: every read of a register sees the value that it is read for, on every
// path from the entry of the function. Going back from the read, the first thing met has to be the definition of that value into that register. It is an error to meet the entry,
// the definition of another value that has been given the same register, or an instruction that clobbers the register. The check generates no code and changes none.
// It is the other half of `--aot-check=spill-slots` (./a-spill-slot-that-lacks-its-value-stops-the-build.test.ts): whoever reads a slot misses a store that is left out, whoever
// reads a register misses a load.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { built, spawned } from "./harness/commands";
import { compileCommand } from "./harness/flags";
import { test } from "./supported";

const env = { ...bunEnv, NO_COLOR: "1" };
// The large functions are those of Bun's own library, which the program brings.
const program = join(import.meta.dir, "parallel", "objects", "spread-replaces-accessors.ts");
const slots = "--aot-check=spill-slots";
const registers = "--aot-check=allocated-registers";

async function build(flags: string[]) {
  const dir = tempDir("aot-allocated-registers", {});
  const executable = join(String(dir), isWindows ? "app.exe" : "app");
  const result = await spawned(
    [bunExe(), ...compileCommand, ...flags, program, "--outfile", executable],
    String(dir),
    env,
  );
  return { dir, executable, result };
}

test("a program passes both checks and runs as plain Bun runs it", async () => {
  const { dir, executable, result } = await build([slots, registers]);
  using _ = dir;
  built(result);
  const plain = await spawned([bunExe(), program], String(dir), env);
  expect(plain.exitCode).toBe(0);
  expect(await spawned([executable], String(dir), env)).toEqual(plain);
}, 300_000);

test.each(["LoadsAheadOfClustersAreNotNeeded", "LoadsBehindCallsAreNotNeeded"])(
  "%s: the check of registers names the register, the value, the reader and the path, and the check of slots sees nothing",
  async sabotage => {
    const byRegisters = await build([registers, `--aot-sabotage=${sabotage}`]);
    using _ = byRegisters.dir;
    expect(byRegisters.result.exitCode).toBe(1);
    expect(byRegisters.result.stderr).toMatch(
      /internal compiler error \(GenerateCode\): RegisterLacksItsValue: .*: a register is read at .* where it does not hold its value; behind register allocation: %\w+ is read for %f?tmp\d+ by `[^`]+` \(#\d+, instruction \d+\), (but `[^`]+` \(#\d+, instruction \d+\) has written the register, and nothing brings the value back|and nothing writes it) on the path #\d+/,
    );
    const bySlots = await build([slots, `--aot-sabotage=${sabotage}`]);
    using __ = bySlots.dir;
    built(bySlots.result);
  },
  300_000,
);

test.each([
  "StoresBehindClustersAreNotNeeded",
  "StoresAheadOfCallsAreNotNeeded",
  "StoresBehindSpilledDefinitionsAreNotNeeded",
])(
  "%s: the check of slots stops the build, and the check of registers sees nothing",
  async sabotage => {
    const bySlots = await build([slots, `--aot-sabotage=${sabotage}`]);
    using _ = bySlots.dir;
    expect(bySlots.result.exitCode).toBe(1);
    expect(bySlots.result.stderr).toContain("internal compiler error (GenerateCode): SpillSlotLacksItsValue");
    const byRegisters = await build([registers, `--aot-sabotage=${sabotage}`]);
    using __ = byRegisters.dir;
    built(byRegisters.result);
  },
  300_000,
);
