// The idioms of ./everyday once more, each compiled as its text would be compiled inside a very large program, against the same text under the same binary's JIT.
//
// In a very large program little counts as code that runs often: what stands in a loop of the text, and what four functions call. A component, a handler or a callback that
// a framework calls is neither. No small program is compiled that way, so ./idioms-against-the-jit.test.ts does not see what such code costs. Here every idiom is built with
// `flagsOfVeryLargeProgram`, its loop finds turn() at run time, and turn() is of ordinary size: ./everyday-idioms.ts says how.
//
// ./behind-the-jit-in-a-very-large-program.<os>-<arch>.json names the idioms that took over 1.2 times the JIT's instructions when they were last measured, with the ratio.
// Each is a todo: `bun test --todo` runs them and tells which have come under 1.2 times.
// `bun test/aot/perf/idioms-against-the-jit.ts --in-a-very-large-program --write-behind` rewrites the file.
// Every other idiom fails at over 1.35 times and 8 instructions. A run measures one idiom in twenty, others for each commit of Bun; AOT_SHARE=all measures all of them.
import { afterAll, expect } from "bun:test";
import { existsSync, readFileSync, rmSync } from "fs";
import { bunExe, isASAN, isDebug, isLinux, isMusl, tempDir } from "harness";
import { inShare, slot } from "../run-programs";
import { describe, test } from "../supported";
import { behindInVeryLargeProgramPath, idiomsAgainstTheJit, isWhole, ratioOf } from "./measure-idioms";

const skipped =
  isDebug || isASAN
    ? "a debug or ASAN build counts other instructions"
    : !isLinux || isMusl
      ? "it counts with perf_event_open, and the list is that of glibc"
      : !existsSync(behindInVeryLargeProgramPath)
        ? `there is no ${behindInVeryLargeProgramPath}`
        : undefined;
if (skipped) console.error(`SKIPPED: test/aot/perf/idioms-in-a-very-large-program.test.ts: ${skipped}`);

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
    if (name in behind) test.todo(`${name}: ${behind[name]} times the JIT's instructions`, staysUnder(name, 1.2, 0));
  for (const name of names)
    if (!(name in behind) && name.startsWith("everyday-") && inShare(name, 20))
      test.concurrent(name, staysUnder(name, 1.35, 8), 900_000);
});
