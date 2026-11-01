// Every idiom of ./everyday, held against the instructions a turn that it took when it was pinned, as TypeScript and as JavaScript: ./everyday-pins.<os>-<arch>.json.
// ./idioms-against-the-jit.measure.ts only holds an idiom under 1.35 times the JIT: an idiom far ahead of the JIT could lose most of that unseen.
// The processor counts: two lengths of run, one taken from the other, over the turns between. ./stepped-idioms.ts holds the same idioms where there is no counter. For 159 idioms in both
// forms stepping took 118 seconds of processor in the program and 311 in the kernel, this 133 and 42.
// A row fails when it reads over its pin by more than 2% and by more than 2 instructions, as in ./stepped-idioms.ts. Two runs of one build, on a machine with four times as many jobs as
// processors, differed by more than that in 0 of 318 rows: the median by nothing, the largest by 0.82%.
// The pin stands still, so small rises add up until they trip it. A pin is never taken anew upward without a word on which change did it and why ("raised"); a row that falls is pinned down.
// The two rulers do not read the same and have pins of their own: this one has the code of Bun, the C library and the collector in, over millions of turns; stepping reads the code that
// the compiler made, over 1 to 256 turns. Of 316 rows 162 read within the bound of the stepped pin, and 202 within it of what stepping reads in compiled and native code together.
// So a row here moves with the build of Bun too. A change under src/ can make the linker and the compiler lay the native code out anew: of the 106 idioms of ./idioms/built-in
// 30 moved by 10 to 20% behind one such change, 14 down and 16 up, with the same compiled code. Before anybody is asked about a row in which a built-in does the work:
// ./symbols.ts says in which functions the instructions lie, in half a minute.
// Marks in a pin, as in ./stepped-idioms.ts:
//   "wavers": 15     it may read that many percent over its pin, and its pin is not lowered; "note": ".." says what was seen
//   "owed": {..}     a change, named in `why`, made the forms named in `forms` dearer and the pins stayed where they were: until a form is back it is held within 10% and 20 instructions,
//                    or 25% and 4; AOT_PERF=lower then takes it out of the list
//   "raised": ".."   why a pin once went up. The row is held like any other
// An idiom that ./behind-the-jit.<os>-<arch>.json or ./typed-dearer-than-untyped.<os>-<arch>.json lists is a todo there, whatever it takes: each of them has a pin here.
// An idiom that the platform's own file does not name is measured, printed and not judged: ./pins-from-a-log.ts writes a file from the log.
// Nothing runs under the JIT here, and 128 idioms are the entry points of one executable.
// `inVeryLargeProgram`: every idiom of ./everyday once more, where turn() is a function of its own that its caller finds at run time, compiled as it would be inside a very large program
// (./everyday-idioms.ts): ./everyday-pins-in-a-very-large-program.<os>-<arch>.json. Most functions of a large application are compiled that way. ./stepped-idioms.ts holds that form where CI
// runs it, but counts compiled code alone: a push that went into the run time at every call took 527 instructions, 209 of them in compiled code.
// ./behind-the-jit-in-a-very-large-program.<os>-<arch>.json excuses an idiom from the line against the JIT, not from its pin here.
// An idiom that got faster for good gets a line, or a lower one:
//
//   bun test/aot/perf/measure.ts pinned-everyday-idioms                  needs a counter of the processor: ./README.md
//   AOT_PERF=lower ..                                                    writes every number that got better into the file, and pins an idiom that has no pin
//   AOT_PERF=update .. -t <name>                                         rewrites the pinned numbers as measured
//   AOT_PERF_BUILD_FLAGS="--aot-.. --aot-.."                             goes to every `bun build --compile --aot`
import { afterAll, expect } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunExe, isASAN, isDebug, isLinux, isMusl, tempDir } from "harness";
import { join } from "path";
import { slot } from "../harness/commands";
import { describe, test } from "../supported";
import { everydayIdioms } from "./everyday-idioms";
import { idiomsAgainstTheJit } from "./measure-idioms";

const mode = process.env.AOT_PERF;
const forms = ["typed", "untyped"] as const;
type Form = (typeof forms)[number];
type Pin = Record<Form, number> & {
  wavers?: number;
  owed?: { forms: Form[]; why: string };
  raised?: string;
  note?: string;
};
type Pins = Record<string, Pin>;
const readKeys = (file: string) => Object.keys(JSON.parse(readFileSync(join(import.meta.dir, file), "utf8")));
const writePins = (path: string, pins: Pins) =>
  writeFileSync(
    path,
    JSON.stringify(Object.fromEntries(Object.entries(pins).sort(([a], [b]) => (a < b ? -1 : 1))), null, 2) + "\n",
  );
const isFarWorse = (now: number, pin: number) =>
  (now > pin * 1.1 && now > pin + 20) || (now > pin * 1.25 && now > pin + 4);
const isWorse = (now: number, pin: Pin, form: Form) =>
  pin.owed?.forms.includes(form)
    ? isFarWorse(now, pin[form])
    : now > pin[form] * (1 + Math.max(pin.wavers ?? 0, 2) / 100) && now > pin[form] + 2;
function lowered(pin: Pin, now: Record<Form, number>): Pin {
  if (pin.wavers) return pin;
  const stillOwed = pin.owed?.forms.filter(form => now[form] > pin[form]) ?? [];
  return {
    ...pin,
    typed: Math.min(pin.typed, now.typed),
    untyped: Math.min(pin.untyped, now.untyped),
    owed: stillOwed.length ? { ...pin.owed!, forms: stillOwed } : undefined,
  };
}

export function pinnedEverydayIdioms(part = 1, parts = 1, inVeryLargeProgram = false) {
  const suffix = inVeryLargeProgram ? "-in-a-very-large-program" : "";
  const pinsPath = join(import.meta.dir, `everyday-pins${suffix}.${process.platform}-${process.arch}.json`);
  const pins: Pins = existsSync(pinsPath) ? JSON.parse(readFileSync(pinsPath, "utf8")) : {};
  const pinnedOnLinuxX64 = readKeys(`everyday-pins${suffix}.linux-x64.json`);
  const measured = [
    ...new Set([...everydayIdioms().map(idiom => idiom.name), ...pinnedOnLinuxX64, ...Object.keys(pins)]),
  ].sort();
  const listedAsTodo = (
    inVeryLargeProgram
      ? ["behind-the-jit-in-a-very-large-program.linux-x64.json"]
      : ["behind-the-jit.linux-x64.json", "typed-dearer-than-untyped.linux-x64.json"]
  ).flatMap(readKeys);
  const skipped =
    isDebug || isASAN
      ? "a debug or ASAN build counts other instructions"
      : !isLinux || isMusl
        ? "it counts with perf_event_open, and the pins are those of glibc"
        : undefined;
  if (skipped) console.error(`SKIPPED: test/aot/perf/pinned-everyday-idioms.ts: ${skipped}`);

  describe.skipIf(!!skipped)(`compile/aot/perf/pinned-everyday-idioms${suffix}`, () => {
    if (skipped) return;
    const folder = String(tempDir("aot-pinned-everyday-idioms", {}));
    afterAll(() => {
      rmSync(folder, { recursive: true, force: true });
      if (mode === "lower" || mode === "update") writePins(pinsPath, pins);
    });
    const { names, measure } = idiomsAgainstTheJit(bunExe(), folder, {
      collections: false,
      jit: false,
      inVeryLargeProgram,
      together: measured.filter((_, index) => index % parts === part - 1),
      buildFlags: process.env.AOT_PERF_BUILD_FLAGS?.split(" ") ?? [],
    });

    if (part === 1)
      test("every pin names an idiom", () => expect(measured.filter(name => !names.includes(name))).toEqual([]));
    if (part === 1)
      test("every idiom has a pin", () =>
        expect(
          [...names, ...listedAsTodo].filter(name => name.startsWith("everyday-") && !pinnedOnLinuxX64.includes(name)),
        ).toEqual([]));
    for (const [index, name] of measured.entries()) {
      if (index % parts !== part - 1 || !names.includes(name)) continue;
      test.concurrent(
        name,
        () =>
          slot(async () => {
            const row = await measure(name);
            if (row.failure === "instructions cannot be counted here")
              return void console.error(`SKIPPED: ${name}: ${row.failure}`);
            expect(row.failure).toBeUndefined();
            if (!row.typed || !row.untyped) throw new Error("not measured");
            const rounded = (count: number) => Math.round(count * 10) / 10;
            const now = { typed: rounded(row.typed.instructions), untyped: rounded(row.untyped.instructions) };
            const pin = pins[name];
            console.error(`EVERYDAY ${name}\t${now.typed}\t${now.untyped}`);
            if (mode === "update") return void (pins[name] = { ...pin, ...now });
            if (!pin) return void (mode === "lower" && (pins[name] = now));
            if (mode === "lower") pins[name] = lowered(pin, now);
            expect({ worse: forms.filter(form => isWorse(now[form], pin, form)), now, pin }).toEqual({
              worse: [],
              now,
              pin,
            });
          }),
        900_000,
      );
    }
  });
}
