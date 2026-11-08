// The idioms of ./everyday once more, each as most functions of a very large program stand, against the same text under the same binary's JIT.
//
// A component, a handler or a callback that a framework calls is a function of its own, and its caller finds it at run time. In a small program turn() is copied into the loop that
// calls it, so ./idioms-against-the-jit.measure.ts does not see what such code costs. Here the loop of every idiom finds turn() at run time, and turn() is of ordinary size:
// ./everyday-idioms.ts says how.
//
// ./behind-the-jit-in-a-very-large-program.<os>-<arch>.json names the idioms that took more instructions than the JIT when they were last measured, with the ratio.
// Each is a todo, and the ratio is only its title: ./everyday-pins-in-a-very-large-program.<os>-<arch>.json holds what it takes (./pinned-everyday-idioms.ts), and that only goes down.
// `bun test --todo` runs them and tells which have come under the JIT.
// `bun test/aot/perf/idioms-against-the-jit.ts --in-a-very-large-program --write-behind` rewrites the file.
// Every other idiom fails at over 1.35 times and 8 instructions.
import { afterAll, expect } from "bun:test";
import { existsSync, readFileSync, rmSync } from "fs";
import { bunExe, isASAN, isDebug, isLinux, isMusl, tempDir } from "harness";
import { slot } from "../harness/commands";
import { describe, test } from "../supported";
import {
  behindInVeryLargeProgramPath,
  idiomsAgainstTheJit,
  isWhole,
  lineAgainstTheJit,
  ratioOf,
} from "./measure-idioms";

const skipped =
  isDebug || isASAN
    ? "a debug or ASAN build counts other instructions"
    : !isLinux || isMusl
      ? "it counts with perf_event_open, and the list is that of glibc"
      : !existsSync(behindInVeryLargeProgramPath)
        ? `there is no ${behindInVeryLargeProgramPath}`
        : undefined;
if (skipped) console.error(`SKIPPED: test/aot/perf/idioms-in-a-very-large-program.measure.ts: ${skipped}`);

describe.skipIf(!!skipped)("compile/aot/perf/idioms-in-a-very-large-program", () => {
  if (skipped) return;
  const folder = String(tempDir("aot-idioms-in-a-very-large-program", {}));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  const behind: Record<string, number> = JSON.parse(readFileSync(behindInVeryLargeProgramPath, "utf8"));
  const { names, measure } = idiomsAgainstTheJit(bunExe(), folder, { collections: false, inVeryLargeProgram: true });

  const staysUnder = (name: string, bound: number, slack: number) => async () => {
    const row = await slot(() => measure(name));
    if (row.failure === "instructions cannot be counted here")
      return void console.error(`SKIPPED: ${name}: ${row.failure}`);
    expect(row.failure).toBeUndefined();
    if (!isWhole(row)) throw new Error("not measured");
    const [typed, untyped, jit] = [row.typed.instructions, row.untyped.instructions, row.jit.instructions];
    const isOver = ratioOf(row) > bound && Math.max(typed, untyped) > jit + slack;
    expect({ typed, untyped, jit, isOver }).toEqual({ typed, untyped, jit, isOver: false });
  };

  for (const name of names)
    if (name in behind)
      test.todo(`${name}: ${behind[name]} times the JIT's instructions`, staysUnder(name, lineAgainstTheJit, 0));
  for (const name of names)
    if (!(name in behind) && name.startsWith("everyday-")) test.concurrent(name, staysUnder(name, 1.35, 8), 900_000);
});
