// No everyday idiom may take much longer compiled ahead of time than under the same binary's JIT. Each idiom of ./everyday is measured as
// ./idioms-against-the-jit.ts says: instructions a turn, as TypeScript and as JavaScript, against the JIT's last tier, inside one test.
//
// ./behind-the-jit.<os>-<arch>.json names the idioms, of ./idioms too, that took over 1.2 times the JIT's instructions when they were last measured, with the ratio.
// Each is a todo: `bun test --todo` runs them and tells which have come under 1.2 times. `bun test/aot/perf/idioms-against-the-jit.ts --write-behind` rewrites the file.
// Every other idiom of ./everyday fails at over 1.35 times and 8 instructions: the JIT's own number moves by up to a tenth from run to run.
// ./idioms.test.ts holds the idioms of ./idioms against pins.
// A run measures one idiom in ten, others for each commit of Bun; AOT_SHARE=all measures all of them (../run-programs.ts).
// AOT_PERF_BUILD_FLAGS="--aot-.. --aot-.." goes to every `bun build --compile --aot`: which idioms an option of the compiler turns red.
//
// Nor may type annotations cost: no idiom, of ./idioms too, may take over 1.05 times and one instruction more as TypeScript than as the same text without its types.
// ./typed-dearer-than-untyped.<os>-<arch>.json names those that did when they were last measured: todos of the same kind, rewritten by the same flag.
// Every other idiom fails at over 1.2 times and two instructions: where a turn allocates much, its cost moves by up to an eighth from run to run.
import { afterAll, expect } from "bun:test";
import { existsSync, readFileSync, rmSync } from "fs";
import { bunExe, isASAN, isDebug, isLinux, isMusl, tempDir } from "harness";
import { inShare, slot } from "../run-programs";
import { describe, test } from "../supported";
import {
  behindPath,
  dearerPath,
  idiomsAgainstTheJit,
  isTypedDearer,
  isWhole,
  ratioOf,
  type Row,
} from "./measure-idioms";

const skipped =
  isDebug || isASAN
    ? "a debug or ASAN build counts other instructions"
    : !isLinux || isMusl
      ? "it counts with perf_event_open, and the list is that of glibc"
      : !existsSync(behindPath)
        ? `there is no ${behindPath}`
        : undefined;
if (skipped) console.error(`SKIPPED: test/aot/perf/idioms-against-the-jit.test.ts: ${skipped}`);

describe.skipIf(!!skipped)("compile/aot/perf/idioms-against-the-jit", () => {
  if (skipped) return;
  const folder = String(tempDir("aot-idioms-against-the-jit", {}));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  const behind: Record<string, number> = JSON.parse(readFileSync(behindPath, "utf8"));
  const dearer: Record<string, number> = existsSync(dearerPath) ? JSON.parse(readFileSync(dearerPath, "utf8")) : {};
  const { names, measure } = idiomsAgainstTheJit(bunExe(), folder, {
    collections: false,
    buildFlags: process.env.AOT_PERF_BUILD_FLAGS?.split(" ") ?? [],
  });
  const rows = new Map<string, Promise<Row>>();
  // An idiom takes about six seconds of one core.
  const taken = names.filter(name => inShare(name, 10));

  const holds = (name: string, isOverBound: (row: Parameters<typeof ratioOf>[0]) => boolean) => async () => {
    if (!rows.has(name))
      rows.set(
        name,
        slot(() => measure(name)),
      );
    const row = await rows.get(name)!;
    if (row.failure === "instructions cannot be counted here")
      return void console.error(`SKIPPED: ${name}: ${row.failure}`);
    expect(row.failure).toBeUndefined();
    if (!isWhole(row)) throw new Error("not measured");
    const [typed, untyped, jit] = [row.typed.instructions, row.untyped.instructions, row.jit.instructions];
    expect({ typed, untyped, jit, isOver: isOverBound(row) }).toEqual({ typed, untyped, jit, isOver: false });
  };
  const staysUnder = (name: string, bound: number, slack: number) =>
    holds(
      name,
      row =>
        ratioOf(row) > bound &&
        Math.max(row.typed.instructions, row.untyped.instructions) > row.jit.instructions + slack,
    );

  for (const name of names)
    if (name in behind) test.todo(`${name}: ${behind[name]} times the JIT's instructions`, staysUnder(name, 1.2, 0));
  for (const name of taken)
    if (!(name in behind) && name.startsWith("everyday-")) test.concurrent(name, staysUnder(name, 1.35, 8), 900_000);
  for (const name of names)
    if (name in dearer)
      test.todo(
        `${name}: ${dearer[name]} times the instructions of the same text without types`,
        holds(name, row => isTypedDearer(row)),
      );
  for (const name of taken)
    if (!(name in dearer))
      test.concurrent(
        `${name}: types cost nothing`,
        holds(name, row => isTypedDearer(row, 1.2, 2)),
        900_000,
      );
});
