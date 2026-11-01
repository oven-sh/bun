// Each idiom of ./idioms and ./everyday, as TypeScript and as JavaScript, built the way a user builds it and held against the instructions that a turn of it took when it was pinned:
// ./idiom-steps.linux-<arch>.json. ./pinned-everyday-idioms.ts does the same with a counter of the processor, over millions of turns: CI has no such counter. ./count-steps.ts needs none:
// it lets the program go one instruction at a time, over the few turns that the pin names.
// A pin holds the instructions in the code that the compiler made. Those of Bun and the C library waver with where the lists of free cells stand, and go by the model of the processor:
// they are not judged.
// ./counted-idioms.ts says what an idiom does beside the straight path. This says what the straight path costs: a call that is no longer copied into its caller, a test more in a loop,
// a load that no longer stands in front of it.
//
// The numbers are exact. A row fails when it reads over its pin by more than 2% and by more than 2 instructions: one instruction more in a turn of fifteen is no news, and every change
// of generated code makes some. The pin stands still, so small rises add up until they trip it: a pin is never taken anew upward without a word on which change did it and why ("raised"),
// and a row that falls is pinned down at once. 4,179 of 4,210 rows read the same to the last digit in seven runs of three builds on two machines under different loads, with a
// temporary folder whose path was three times as long, with the idioms shared out among the executables as the eight parts of this test share them out, and shared out again with one idiom fewer.
// Not tried: another model of processor, and a container in which no process may watch another, where this test skips itself.
// A row that reads over its pin is read again, up to four times, each time with a few bytes more in the environment, and judged by the smallest number: what a change of the compiler costs
// comes every time. What goes by addresses does not. One executable took 4,023 instructions for a turn of names-seen.kept-and-asked-48 in every run, and 3,543 with eight bytes more in the
// environment: the engine keeps, for the objects of a shape, the union of the addresses of the names that it has seen there, and whether that rules out a name that is absent goes by where
// the names were allocated: so by all that was allocated before, by the build of Bun and by what else the executable holds.
// Two kinds of rows are held more loosely, and the pin says which:
//   "wavers": 35     the idiom goes by addresses, by chance or by what else its executable holds: it may read that many percent over its pin, and its pin is not lowered
//   "owed": {..}     a change, named in `why`, made the forms named in `forms` dearer and the pins stayed where they were. Until a form is back it is held within 10% and 20
//                    instructions, or 25% and 4; AOT_PERF=lower then takes it out of the list
// "raised": ".." says why a pin once went up: what the change was for. The row is held like any other. "note": ".." says what was seen before a row was let waver.
//
// "called-once": the idioms of ./everyday stand in the form of main(), run() and the body of a test: the function that holds the loop is called once (./everyday-idioms.ts).
// Their pins are ./idiom-steps-called-once.linux-<arch>.json. When they were first pinned, a turn took 21.1% more there than in the other form, by the geometric mean of 3,629 rows; 336 rows took over twice as much.
// Nothing is warmed up there and the turns are few: what happens once falls into the turns that are counted or beside them by the build of Bun. Two idioms of 1,836 went to and fro by 16
// instructions over four builds, the two forms of one each for itself: they are among those that waver.
//
// "in-a-very-large-program": turn() is a function of its own that its caller finds at run time, compiled as it would be inside a very large program, where nothing marks it as code that
// runs often: most functions of a large application are compiled that way. Their pins are ./idiom-steps-in-a-very-large-program.linux-<arch>.json.
//
// A pin only goes down: a number that has to rise is a trade, and somebody decides it.
//   AOT_PERF=lower bun test test/aot/perf/stepped-idioms-     writes every number that got better into the file
//   AOT_PERF=update ..                                        rewrites the pins as counted, and how many turns a reading takes: for a new idiom
import { afterAll, expect } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunExe, isASAN, isDebug, isMusl, tempDir } from "harness";
import { join } from "path";
import { slot } from "../harness/commands";
import { describe, test } from "../supported";
import { forms, type Form, type Surroundings } from "./count-idioms";
import { steppedIdioms, whyNoSteps } from "./step-idioms";

const mode = process.env.AOT_PERF;
/** Without `turns`: one turn is too long to step through. */
type Pin = Partial<Record<Form, number>> & { turns?: number; wavers?: number; owed?: { forms: Form[]; why: string }; raised?: string; note?: string };
type Pins = Record<string, Pin>;
const readPins = (path: string): Pins => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {});
const writePins = (path: string, pins: Pins) =>
  writeFileSync(path, `{\n${Object.keys(pins).sort().map(name => `${JSON.stringify(name)}: ${JSON.stringify(pins[name])}`).join(",\n")}\n}\n`);
/** As in ./pinned-everyday-idioms.ts. */
const isFarWorse = (now: number, pin: number) => (now > pin * 1.1 && now > pin + 20) || (now > pin * 1.25 && now > pin + 4);
const isWorse = (now: number, pin: Pin, form: Form) =>
  pin.owed?.forms.includes(form) ? isFarWorse(now, pin[form]!) : now > pin[form]! * (1 + Math.max(pin.wavers ?? 0, 2) / 100) && now > pin[form]! + 2;

export function steppedIdiomsAgainstPins(part = 1, parts = 1, surroundings: Surroundings = "ordinary") {
  const suffix = surroundings === "ordinary" ? "" : `-${surroundings}`;
  const pinsPath = join(import.meta.dir, `idiom-steps${suffix}.linux-${process.arch}.json`);
  const skipped =
    isDebug || isASAN
      ? "a debug or ASAN build generates checks of its own"
      : isMusl
        ? "./count-steps.ts opens glibc"
        : (whyNoSteps(bunExe()) ?? (existsSync(pinsPath) || mode === "update" ? undefined : `there is no ${pinsPath}`));
  if (skipped) console.error(`SKIPPED: test/aot/perf/stepped-idioms.ts: ${skipped}`);

  describe.skipIf(!!skipped)(`compile/aot/perf/stepped-idioms${suffix}`, () => {
    if (skipped) return;
    const pins = readPins(pinsPath);
    const written: Pins = {};
    const folder = String(tempDir("aot-stepped-idioms", {}));
    let all: string[] = [];
    const { names, aTurn, turnsFor, startBuilds } = steppedIdioms(
      bunExe(),
      folder,
      every => (all = every).filter((_, index) => index % parts === part - 1),
      surroundings,
    );
    afterAll(() => {
      rmSync(folder, { recursive: true, force: true });
      // Another part may have written since this one read.
      if (Object.keys(written).length) writePins(pinsPath, { ...readPins(pinsPath), ...written });
    });
    startBuilds();

    if (part === 1) {
      test("every pin names an idiom", () => expect(Object.keys(pins).filter(name => !all.includes(name))).toEqual([]));
      test.skipIf(mode === "update")("every idiom has a pin", () => expect(all.filter(name => !(name in pins))).toEqual([]));
    }
    for (const name of names)
      test.concurrent(
        name,
        () =>
          slot(async () => {
            const pin = mode === "update" ? undefined : pins[name];
            const turns = pin ? pin.turns : mode === "update" || mode === "lower" ? await turnsFor(name) : undefined;
            if (turns === undefined) return void (!pin && mode && (written[name] = {}));
            const read = async (padding = 0) => ({ typed: (await aTurn(name, "typed", turns, padding)).compiled, untyped: (await aTurn(name, "untyped", turns, padding)).compiled });
            const now = await read();
            if (!pin) return void (written[name] = forms.every(form => Number.isFinite(now[form])) ? { turns, ...now } : {});
            for (const padding of [8, 12, 24, 28]) {
              if (!forms.some(form => isWorse(now[form], pin, form))) break;
              const again = await read(padding);
              for (const form of forms) now[form] = Math.min(now[form], again[form]);
            }
            if (mode === "lower" && !pin.wavers) {
              const { owed, ...paid } = pin;
              const stillOwed = owed?.forms.filter(form => now[form] > pin[form]!) ?? [];
              written[name] = { ...paid, typed: Math.min(pin.typed!, now.typed), untyped: Math.min(pin.untyped!, now.untyped) };
              if (stillOwed.length) written[name].owed = { forms: stillOwed, why: owed!.why };
            }
            expect(
              forms.filter(form => isWorse(now[form], pin, form)).map(form => `${name}, ${form}: ${now[form]} instructions of compiled code a turn, pinned at ${pin[form]}`),
            ).toEqual([]);
          }),
        900_000,
      );
  });
}
