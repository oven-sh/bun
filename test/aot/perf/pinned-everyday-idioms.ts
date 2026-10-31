// The idioms of ./everyday that ./everyday-pins.<os>-<arch>.json names, each held against the instructions a turn that it took when it was pinned, as TypeScript and as JavaScript.
// ./idioms-against-the-jit.measure.ts only holds an idiom under 1.35 times the JIT: an idiom far ahead of the JIT could lose most of that unseen.
// An idiom that ./behind-the-jit.<os>-<arch>.json or ./typed-dearer-than-untyped.<os>-<arch>.json lists is a todo there, whatever it takes: each of them has a pin here.
// An idiom that Linux on x64 pins and the platform's own file does not name is measured, printed and not judged: ./pins-from-a-log.ts writes a file from the log.
// Nothing runs under the JIT here, and 128 idioms are the entry points of one executable.
// An idiom that got faster for good gets a line, or a lower one:
//
//   bun test/aot/perf/measure.ts pinned-everyday-idioms                  needs a counter of the processor: ./README.md
//   AOT_PERF=lower ..                                                    writes every number that got better into the file
//   AOT_PERF=update ..                                                   rewrites the pinned numbers as measured
//   AOT_PERF_BUILD_FLAGS="--aot-.. --aot-.."                             goes to every `bun build --compile --aot`
import { afterAll, expect } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunExe, isASAN, isDebug, isLinux, isMusl, tempDir } from "harness";
import { join } from "path";
import { slot } from "../harness/commands";
import { describe, test } from "../supported";
import { idiomsAgainstTheJit } from "./measure-idioms";

const pinsPath = join(import.meta.dir, `everyday-pins.${process.platform}-${process.arch}.json`);
const mode = process.env.AOT_PERF;
const forms = ["typed", "untyped"] as const;
type Pins = Record<string, Record<(typeof forms)[number], number>>;
const pins: Pins = existsSync(pinsPath) ? JSON.parse(readFileSync(pinsPath, "utf8")) : {};
const readKeys = (file: string) => Object.keys(JSON.parse(readFileSync(join(import.meta.dir, file), "utf8")));
const pinnedOnLinuxX64 = readKeys("everyday-pins.linux-x64.json");
const measured = [...new Set([...pinnedOnLinuxX64, ...Object.keys(pins)])];
const listedAsTodo = ["behind-the-jit.linux-x64.json", "typed-dearer-than-untyped.linux-x64.json"].flatMap(readKeys);
const isWorse = (now: number, pin: number) =>
  (now > pin * 1.1 && now > pin + 20) || (now > pin * 1.25 && now > pin + 4);
// One executable takes a twelfth more on one machine than on another, and a turn costs less the more turns the plan of ./measure-idioms.ts has: held within 15%.
const wavering = ["everyday-dictionaries-built-anew/names-seen.one-of-256-lists-of-40-and-the-last-dictionary-stays"];

export function pinnedEverydayIdioms(part = 1, parts = 1) {
  const skipped =
    isDebug || isASAN
      ? "a debug or ASAN build counts other instructions"
      : !isLinux || isMusl
        ? "it counts with perf_event_open, and the pins are those of glibc"
        : undefined;
  if (skipped) console.error(`SKIPPED: test/aot/perf/pinned-everyday-idioms.ts: ${skipped}`);

  describe.skipIf(!!skipped)("compile/aot/perf/pinned-everyday-idioms", () => {
    if (skipped) return;
    const folder = String(tempDir("aot-pinned-everyday-idioms", {}));
    afterAll(() => {
      rmSync(folder, { recursive: true, force: true });
      if (mode === "lower" || mode === "update") writeFileSync(pinsPath, JSON.stringify(pins, null, 2) + "\n");
    });
    const { names, measure } = idiomsAgainstTheJit(bunExe(), folder, {
      collections: false,
      jit: false,
      together: measured.filter((_, index) => index % parts === part - 1),
      buildFlags: process.env.AOT_PERF_BUILD_FLAGS?.split(" ") ?? [],
    });

    if (part === 1)
      test("every pin names an idiom", () => expect(measured.filter(name => !names.includes(name))).toEqual([]));
    if (part === 1)
      test("every idiom that is listed as a todo has a pin", () =>
        expect(listedAsTodo.filter(name => name.startsWith("everyday-") && !pinnedOnLinuxX64.includes(name))).toEqual(
          [],
        ));
    if (part === 1)
      for (const name of wavering)
        test.todo(`${name}: takes as many instructions a turn on every machine, whatever the number of turns`);
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
            const isOver = wavering.includes(name) ? (now: number, pin: number) => now > pin * 1.15 : isWorse;
            console.error(`EVERYDAY ${name}\t${now.typed}\t${now.untyped}`);
            if (mode === "update") return void (pins[name] = now);
            if (!pin) return;
            if (mode === "lower")
              pins[name] = { typed: Math.min(pin.typed, now.typed), untyped: Math.min(pin.untyped, now.untyped) };
            expect({ worse: forms.filter(form => isOver(now[form], pin[form])), now, pin }).toEqual({
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
