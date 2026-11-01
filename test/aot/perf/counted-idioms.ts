// Each idiom of ./idioms and ./everyday, as TypeScript and as JavaScript, held against what a thousand turns of it counted when it was pinned: ./idiom-counts.json.
// ./count-idioms.ts says what is counted, and how. ./pinned-everyday-idioms.ts holds the same idioms against instructions, which needs a counter of the processor: CI has none.
// What the counts see: whatever makes the compiler know less, so that a read, a store or a call looks a name up, a test more runs, a cell more is made.
// `B.prototype.area = ..` behind TypeScript's __extends lost its place among the members of B once: 0 > 3,000 arrivals, three times the instructions.
// What they do not see: the same events in more instructions. A call that is no longer copied into its caller, a load that no longer stands in front of the loop.
//
// "in-a-very-large-program": the idioms of ./everyday once more, where turn() is a function of its own that its caller finds at run time, compiled as it would be inside a very large
// program (./everyday-idioms.ts): most functions of a large application are compiled that way, and there a read that the other form resolves may look its name up, and a push that the
// other form gives room may go into the run time at every call: ./stepped-idioms.ts counts compiled code alone and does not see what the run time then takes.
// Their pins are ./idiom-counts-in-a-very-large-program.json: taken on Linux with glibc, x64 and arm64, and held there alone.
//
// It is a ruler, not the test of a fault. In front of a merge one idiom in four is counted, another quarter each day (../harness/ways.ts). AOT_WHOLE_GRIDS=1 counts
// them all: the bench behind every build does, and there a count that has moved is dated to the change that moved it.
//
// A pin says "at most". It only goes down: a count that has to rise is a trade, and somebody decides it.
//   AOT_PERF=lower bun test test/aot/perf/counted-idioms-     writes every number that got better into the file
//   AOT_PERF=cover ..                                         raises each pin to what is counted here: the same sources on another platform, where lists of free cells and tables are of other sizes
//   AOT_PERF=update ..                                        rewrites the pins as counted: for a new idiom
// A row may carry "owed": { <kind>: <count>, "why": .. }: a change, named in "why", made that kind more expensive in both forms, and the pin was left where it was.
// Until that is fixed, the kind is held to the count written there. A higher count fails. So does meeting the pin again: then the mark should be removed.
// "raised": ".." says why a count once went up: what the change was for. The row is held like any other.
import { afterAll, expect } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "fs";
import { bunExe, isArm64, isASAN, isDebug, isLinux, isMusl, tempDir } from "harness";
import { join } from "path";
import { slot } from "../harness/commands";
import { partOfGrid } from "../harness/ways";
import { describe, test } from "../supported";
import { countedIdioms, forms, kinds, whatWasCounted, type Counted, type Counts, type Form, type Surroundings } from "./count-idioms";

const mode = process.env.AOT_PERF;
/** A kind that is left out is 0. */
type Pins = Record<string, Record<Form, Partial<Counts>> & { owed?: Partial<Counts> & { why: string }; raised?: string }>;
const readPins = (pinsPath: string): Pins => JSON.parse(readFileSync(pinsPath, "utf8"));

/** An idiom a line. */
function writePins(pinsPath: string, pins: Pins) {
  const withoutZeros = (counts: Partial<Counts>) => Object.fromEntries(kinds.filter(kind => counts[kind]).map(kind => [kind, counts[kind]]));
  const lines = Object.keys(pins)
    .sort()
    .map(name => `${JSON.stringify(name)}: ${JSON.stringify({ typed: withoutZeros(pins[name].typed), untyped: withoutZeros(pins[name].untyped), owed: pins[name].owed, raised: pins[name].raised })}`);
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
/** A row is held against all that is allocated, or against the part that compiled code allocates: the first where the row says so. */
const partOrWhole = (pin: Partial<Counts> | undefined) => (kind: (typeof kinds)[number]) =>
  pin?.allCells === undefined ? kind !== "allCells" && kind !== "allBytes" : kind !== "cells" && kind !== "bytes";

/**
 * All that is allocated is counted in lists of free cells, and comes out wrong by up to a list for each size of cell, either way. A block of 16 KB has 512 cells of 32 bytes.
 * On Linux on arm64 a block has 64 KB and 2,048 of them: two cells a turn, where a pin is there to see one. So there the whole is neither held nor written.
 * everyday-downleveled/async.awaiter-helper: compiled code and its stubs allocate 19,000 cells on both, and the whole is 19,164 on x64 and 21,550 or 18,864 there.
 */
const isCountedHere = (kind: (typeof kinds)[number]) => !(isLinux && isArm64) || (kind !== "allCells" && kind !== "allBytes");

/** The most that the program can have done: what a pin holds. */
const mostOf = ({ counts, refills }: Counted): Counts => ({ ...counts, operations: counts.operations + refills });

export function countedIdiomsAgainstPins(part = 1, parts = 1, surroundings: Surroundings = "ordinary") {
  const suffix = surroundings === "ordinary" ? "" : `-${surroundings}`;
  const pinsPath = join(import.meta.dir, `idiom-counts${suffix}.json`);
  const skipped =
    isDebug || isASAN
      ? "a debug or ASAN build generates checks of its own, which branch and call"
      : suffix && (!isLinux || isMusl)
        ? "these pins were taken on Linux with glibc alone"
        : undefined;
  if (skipped) console.error(`SKIPPED: test/aot/perf/counted-idioms.ts: ${skipped}`);

  describe.skipIf(!!skipped)(`compile/aot/perf/counted-idioms${suffix}`, () => {
    if (skipped) return;
    const pins = readPins(pinsPath);
    const written: Pins = {};
    const folder = String(tempDir("aot-counted-idioms", {}));
    let all: string[] = [];
    // Whoever writes pins writes all of them.
    const oneIn = mode ? 1 : 4;
    const ofThisPart = (every: string[]) => (all = every).filter((_, index) => index % parts === part - 1);
    const { names, count, startBuilds } = countedIdioms(bunExe(), folder, every => [...partOfGrid(`counted-idioms${suffix}`, ofThisPart(every), oneIn, name => name)], [], surroundings);
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
            const now = { typed: await count(name, "typed"), untyped: await count(name, "untyped") };
            expect(now.untyped.printed).toBe(now.typed.printed);
            const pin = pins[name];
            const merged = (choose: (pin: number, now: number) => number) =>
              ({
                ...Object.fromEntries(
                  forms.map(form => [form, Object.fromEntries(kinds.filter(partOrWhole(pin?.[form])).map(kind => [kind, isCountedHere(kind) ? choose(pin?.[form][kind] ?? 0, mostOf(now[form])[kind]) : (pin?.[form][kind] ?? 0)]))]),
                ),
                owed: pin?.owed,
                raised: pin?.raised,
              }) as Pins[string];
            if (mode === "update" || ((mode === "lower" || mode === "cover") && !pin)) return void (written[name] = merged((_, now) => now));
            if (!pin) return;
            if (mode === "lower") written[name] = merged(Math.min);
            if (mode === "cover") return void (written[name] = merged(Math.max));
            const over = forms.flatMap(form =>
              kindsJudged(now[form])
                .filter(partOrWhole(pin[form]))
                .filter(isCountedHere)
                .filter(kind => now[form].counts[kind] > (pin.owed?.[kind] ?? pin[form][kind] ?? 0))
                .map(kind => `${form}: ${now[form].counts[kind]} ${kind} in a thousand turns, pinned at ${pin[form][kind] ?? 0}`),
            );
            const paid = kinds.filter(kind => pin.owed?.[kind] !== undefined && forms.every(form => now[form].counts[kind] <= (pin[form][kind] ?? 0)));
            over.push(...paid.map(kind => `${kind}: the pin is met again: remove "owed"`));
            const counted = Object.fromEntries(forms.filter(form => over.some(line => line.startsWith(form))).map(form => [form, whatWasCounted(now[form].lines)]));
            expect({ over, counted }).toEqual({ over: [], counted: {} });
          }),
        900_000,
      );
  });
}
