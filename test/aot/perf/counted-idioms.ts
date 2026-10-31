// Each idiom of ./idioms and ./everyday, as TypeScript and as JavaScript, held against what a thousand turns of it counted when it was pinned: ./idiom-counts.json.
// ./count-idioms.ts says what is counted, and how. ./pinned-everyday-idioms.ts holds the same idioms against instructions, which needs a counter of the processor: CI has none.
// What the counts see: whatever makes the compiler know less, so that a read, a store or a call looks a name up, a test more runs, a cell more is made.
// `B.prototype.area = ..` behind TypeScript's __extends lost its place among the members of B once: 0 > 3,000 arrivals, three times the instructions.
// What they do not see: the same events in more instructions. A call that is no longer copied into its caller, a load that no longer stands in front of the loop.
//
// A pin says "at most". It only goes down: a count that has to rise is a trade, and somebody decides it.
//   AOT_PERF=lower bun test test/aot/perf/counted-idioms-     writes every number that got better into the file
//   AOT_PERF=cover ..                                         raises each pin to what is counted here: the same sources on another platform, where lists of free cells and tables are of other sizes
//   AOT_PERF=update ..                                        rewrites the pins as counted: for a new idiom
import { afterAll, expect } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "fs";
import { bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "path";
import { slot } from "../harness/commands";
import { describe, test } from "../supported";
import { countedIdioms, forms, kinds, whatWasCounted, type Counted, type Counts, type Form } from "./count-idioms";

const pinsPath = join(import.meta.dir, "idiom-counts.json");
const mode = process.env.AOT_PERF;
/** A kind that is left out is 0. */
type Pins = Record<string, Record<Form, Partial<Counts>>>;
const readPins = (): Pins => JSON.parse(readFileSync(pinsPath, "utf8"));

/** An idiom a line. */
function writePins(pins: Pins) {
  const withoutZeros = (counts: Partial<Counts>) => Object.fromEntries(kinds.filter(kind => counts[kind]).map(kind => [kind, counts[kind]]));
  const lines = Object.keys(pins)
    .sort()
    .map(name => `${JSON.stringify(name)}: ${JSON.stringify({ typed: withoutZeros(pins[name].typed), untyped: withoutZeros(pins[name].untyped) })}`);
  writeFileSync(pinsPath, `{\n${lines.join(",\n")}\n}\n`);
}

/**
 * What the caches of the run time count of themselves. A table that is full throws out whatever lies where the newcomer wants to lie, and what finds no place is not filed: that goes by
 * addresses, so by what else the executable holds, by the platform, and by how long the path of the temporary folder is. What has no place is looked for again, so the calls into the
 * run time go by them too, and so does what a stub allocates where it finds nothing filed. What the compiled code itself does, does not: its accesses by name and its branches.
 */
const countersOfCaches = [
  "SiteCacheRefills",
  "HashedTableEvictions",
  "HashedTableGrowths",
  "ChainDependentsDropped",
  "GlobalBindingNotFiled",
  "FirstMissesNotFiled",
  "AnswersNotFiled",
  "PairsFiledAgain",
  "PairsFiledAgainWhilePresent",
];
const kindsJudged = ({ lines }: Counted) =>
  countersOfCaches.some(name => lines.has(`counter:${name}`)) ? kinds.filter(kind => kind === "arrivals" || kind === "branches") : kinds;

/** The most that the program can have done: what a pin holds. */
const mostOf = ({ counts, refills }: Counted): Counts => ({ ...counts, operations: counts.operations + refills });

export function countedIdiomsAgainstPins(part = 1, parts = 1) {
  const skipped = isDebug || isASAN ? "a debug or ASAN build generates checks of its own, which branch and call" : undefined;
  if (skipped) console.error(`SKIPPED: test/aot/perf/counted-idioms.ts: ${skipped}`);

  describe.skipIf(!!skipped)("compile/aot/perf/counted-idioms", () => {
    if (skipped) return;
    const pins = readPins();
    const written: Pins = {};
    const folder = String(tempDir("aot-counted-idioms", {}));
    let all: string[] = [];
    const { names, count, startBuilds } = countedIdioms(bunExe(), folder, every => (all = every).filter((_, index) => index % parts === part - 1));
    afterAll(() => {
      rmSync(folder, { recursive: true, force: true });
      // Another part may have written since this one read.
      if (Object.keys(written).length) writePins({ ...readPins(), ...written });
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
            const now = { typed: await count(name, "typed"), untyped: await count(name, "untyped") };
            expect(now.untyped.printed).toBe(now.typed.printed);
            const pin = pins[name];
            const merged = (choose: (pin: number, now: number) => number) =>
              Object.fromEntries(
                forms.map(form => [form, Object.fromEntries(kinds.map(kind => [kind, choose(pin?.[form][kind] ?? 0, mostOf(now[form])[kind])]))]),
              ) as Pins[string];
            if (mode === "update" || ((mode === "lower" || mode === "cover") && !pin)) return void (written[name] = merged((_, now) => now));
            if (!pin) return;
            if (mode === "lower") written[name] = merged(Math.min);
            if (mode === "cover") return void (written[name] = merged(Math.max));
            const over = forms.flatMap(form =>
              kindsJudged(now[form])
                .filter(kind => now[form].counts[kind] > (pin[form][kind] ?? 0))
                .map(kind => `${form}: ${now[form].counts[kind]} ${kind} in a thousand turns, pinned at ${pin[form][kind] ?? 0}`),
            );
            const counted = Object.fromEntries(forms.filter(form => over.some(line => line.startsWith(form))).map(form => [form, whatWasCounted(now[form].lines)]));
            expect({ over, counted }).toEqual({ over: [], counted: {} });
          }),
        900_000,
      );
  });
}
