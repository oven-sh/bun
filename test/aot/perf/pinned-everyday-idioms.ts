// The idioms of ./everyday that ./everyday-pins.<os>-<arch>.json names, each held against the instructions a turn that it took when it was pinned, as TypeScript and as JavaScript.
// ./idioms-against-the-jit.test.ts only holds an idiom under 1.35 times the JIT, and one run in ten measures it: an idiom far ahead of the JIT could lose most of that unseen.
// Every run measures all of these. An idiom that Linux on x64 pins and the platform's own file does not name is measured, printed and not judged: ./pins-from-a-log.ts writes a file from the log.
// An idiom that got faster for good gets a line, or a lower one:
//
//   AOT_PERF=lower TEST_PART=aot/perf/pinned-everyday-idioms bun test test/aot/parts.test.ts    writes every number that got better into the file
//   AOT_PERF=update ..                                                                          rewrites the pinned numbers as measured
//   AOT_PERF_BUILD_FLAGS="--aot-.. --aot-.."                                                    goes to every `bun build --compile --aot`
import { afterAll, expect } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunExe, isASAN, isDebug, isLinux, isMusl, tempDir } from "harness";
import { join } from "path";
import { slot } from "../run-programs";
import { describe, test } from "../supported";
import { idiomsAgainstTheJit, isWhole } from "./measure-idioms";

const pinsPath = join(import.meta.dir, `everyday-pins.${process.platform}-${process.arch}.json`);
const mode = process.env.AOT_PERF;
const forms = ["typed", "untyped"] as const;
type Pins = Record<string, Record<(typeof forms)[number], number>>;
const pins: Pins = existsSync(pinsPath) ? JSON.parse(readFileSync(pinsPath, "utf8")) : {};
const measured = Object.keys({
  ...(JSON.parse(readFileSync(join(import.meta.dir, "everyday-pins.linux-x64.json"), "utf8")) as Pins),
  ...pins,
});
const isWorse = (now: number, pin: number) =>
  (now > pin * 1.1 && now > pin + 20) || (now > pin * 1.25 && now > pin + 4);

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
      buildFlags: process.env.AOT_PERF_BUILD_FLAGS?.split(" ") ?? [],
    });

    if (part === 1) test("every pin names an idiom", () => expect(measured.filter(name => !names.includes(name))).toEqual([]));
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
            if (!isWhole(row)) throw new Error("not measured");
            const rounded = (count: number) => Math.round(count * 10) / 10;
            const now = { typed: rounded(row.typed.instructions), untyped: rounded(row.untyped.instructions) };
            const pin = pins[name];
            console.error(`EVERYDAY ${name}\t${now.typed}\t${now.untyped}`);
            if (mode === "update") return void (pins[name] = now);
            if (!pin) return;
            if (mode === "lower")
              pins[name] = { typed: Math.min(pin.typed, now.typed), untyped: Math.min(pin.untyped, now.untyped) };
            expect({ worse: forms.filter(form => isWorse(now[form], pin[form])), now, pin }).toEqual({ worse: [], now, pin });
          }),
        900_000,
      );
    }
  });
}
