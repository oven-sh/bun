// Each row of ./operations/generate.py, held against the instructions that one site of it took in compiled code when it was pinned: ./operation-steps.linux-<arch>.json.
// ./operations.measure.ts does the same with a counter of the processor: CI has no such counter. ./count-steps.ts needs none: ./step-operations.ts says how a site is counted.
//
// Every row is counted twice. `alone`: the whole program is in sight. `opened`: the same text, but every object, array, closure and string that the row works on has been handed once to text
// that is evaluated at run time, and has come back: nothing is left but the written types, which is the state of most accesses of a large program. No idiom of ./idioms or ./everyday
// stands in such a program: a call of a typed closure that had left sight went from 1 instruction to 35 once, and every other test was green.
//
// The numbers are exact. A row fails when it reads over its pin by more than 2% and by more than 2 instructions, and a pin is never taken anew upward without a word on which change did it:
// ./stepped-idioms.ts says why. A row that reads over that is read again first, as there.
//
// A pin only goes down: a number that has to rise is a trade, and somebody decides it.
//   AOT_PERF=lower bun test test/aot/perf/stepped-operations-     writes every number that got better into the file
//   AOT_PERF=update ..                                            rewrites the pins as counted: for a new row
import { afterAll, expect } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunExe, isASAN, isDebug, isMusl, tempDir } from "harness";
import { join } from "path";
import { slot } from "../harness/commands";
import { describe, test } from "../supported";
import { whyNoSteps } from "./step-idioms";
import { columns, steppedOperations, type Column } from "./step-operations";

const mode = process.env.AOT_PERF;
type Pin = Partial<Record<Column, number>> & { raised?: string };
type Pins = Record<string, Pin>;
const readPins = (path: string): Pins => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {});
const writePins = (path: string, pins: Pins) =>
  writeFileSync(path, `{\n${Object.keys(pins).sort().map(name => `${JSON.stringify(name)}: ${JSON.stringify(pins[name])}`).join(",\n")}\n}\n`);

export function steppedOperationsAgainstPins(part = 1, parts = 1) {
  const pinsPath = join(import.meta.dir, `operation-steps.linux-${process.arch}.json`);
  const python = Bun.which("python3");
  const skipped =
    isDebug || isASAN
      ? "a debug or ASAN build generates checks of its own"
      : isMusl
        ? "./count-steps.ts opens glibc"
        : !python
          ? "python3 is not installed"
          : (whyNoSteps(bunExe()) ?? (existsSync(pinsPath) || mode === "update" ? undefined : `there is no ${pinsPath}`));
  if (skipped) console.error(`SKIPPED: test/aot/perf/stepped-operations.ts: ${skipped}`);

  describe.skipIf(!!skipped)("compile/aot/perf/stepped-operations", () => {
    if (skipped) return;
    const pins = readPins(pinsPath);
    const written: Pins = {};
    const folder = String(tempDir("aot-stepped-operations", {}));
    const { rows, aSite, remove } = steppedOperations(bunExe(), folder, python!);
    afterAll(() => {
      rmSync(folder, { recursive: true, force: true });
      // Another part may have written since this one read.
      if (Object.keys(written).length) writePins(pinsPath, { ...readPins(pinsPath), ...written });
    });

    if (part === 1) {
      test("every pin names a row", () => expect(Object.keys(pins).filter(name => !rows.some(row => row.name === name))).toEqual([]));
      test.skipIf(mode === "update")("every row has a pin", () => expect(rows.filter(row => !(row.name in pins)).map(row => row.name)).toEqual([]));
    }
    for (const row of rows.filter((_, index) => index % parts === part - 1))
      test.concurrent(
        `${row.name}: ${row.what}`,
        () =>
          slot(async () => {
            try {
              const read = async (padding = 0) => ({ alone: await aSite("alone", row, padding), opened: await aSite("opened", row, padding) });
              const now = await read();
              const pin = mode === "update" ? undefined : pins[row.name];
              if (!pin) return void (mode && (written[row.name] = now));
              const isWorse = (column: Column) => now[column] > pin[column]! * 1.02 && now[column] > pin[column]! + 2;
              for (const padding of [8, 12, 24, 28]) {
                if (!columns.some(isWorse)) break;
                const again = await read(padding);
                for (const column of columns) now[column] = Math.min(now[column], again[column]);
              }
              if (mode === "lower") written[row.name] = { ...pin, alone: Math.min(pin.alone!, now.alone), opened: Math.min(pin.opened!, now.opened) };
              expect(columns.filter(isWorse).map(column => `${row.name}, ${column}: ${now[column]} instructions of compiled code a site, pinned at ${pin[column]}`)).toEqual([]);
            } finally {
              for (const column of columns) remove(column, row.name);
            }
          }),
        900_000,
      );
  });
}
