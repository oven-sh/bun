// Each row of ./first-executions.ts held against the instructions that an item of it took when it was pinned: ./first-executions.linux-x64.json.
// ./count-steps.ts counts them, one at a time, so CI needs no counter of the processor. Nearly all of them lie in the run time, whose count wavers a little with where the lists of free cells stand
// and with the routines that the C library picks for the processor: over a hundred items that is under an instruction an item.
// ./step-profile.ts says where an item's instructions lie.
//
// A pin only goes down: a number that has to rise is a trade, and somebody decides it.
//   AOT_PERF=lower bun test test/aot/perf/first-executions.test.ts     writes every number that got better into the file
//   AOT_PERF=update ..                                                 rewrites the pins as counted: for a new row
import { expect } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isMusl, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, withoutDebugInformation } from "../harness/commands";
import { withSteadyCollections } from "../harness/counted-run";
import { afterAll } from "../harness/default-timeout";
import { describe, test } from "../supported";
import { pushes, rows, writeProgram, yardstick, type Row } from "./first-executions";
import { whyNoSteps } from "./step-idioms";

const pinsPath = join(import.meta.dir, "first-executions.linux-x64.json");
const mode = process.env.AOT_PERF;
type Pins = Record<string, number>;
const readPins = (): Pins => (existsSync(pinsPath) ? JSON.parse(readFileSync(pinsPath, "utf8")) : {});
const items = 100;
/** Two switches of context an instruction: seconds of work take minutes where the processors are taken. */
const limitOfSteppedRun = 840_000;
/** As in ./stepped-idioms.ts. */
const isWorse = (now: number, pin: number) =>
  (now > pin * 1.1 && now > pin + 20) || (now > pin * 1.25 && now > pin + 4);

const skipped =
  isDebug || isASAN
    ? "a debug or ASAN build counts other instructions"
    : isMusl
      ? "./count-steps.ts opens glibc"
      : whyNoSteps(bunExe());
if (skipped) console.error(`SKIPPED: test/aot/perf/first-executions.test.ts: ${skipped}`);

describe.skipIf(!!skipped)("compile/aot/perf/first-executions", () => {
  if (skipped) return;
  const pins = readPins();
  const written: Pins = {};
  const root = String(tempDir("aot-first-executions", {}));
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
    if (!Object.keys(written).length) return;
    const all = { ...readPins(), ...written };
    writeFileSync(
      pinsPath,
      `{\n${Object.keys(all)
        .sort()
        .map(name => `${JSON.stringify(name)}: ${all[name]}`)
        .join(",\n")}\n}\n`,
    );
  });

  async function stepsOf(row: Row, count: number) {
    const folder = join(root, `${[yardstick, ...rows].indexOf(row)}-${count}`);
    const executable = join(folder, "main");
    built(
      await spawned(
        [
          bunExe(),
          "build",
          "--compile",
          "--aot",
          ...withoutDebugInformation(),
          writeProgram(folder, row, count),
          "--outfile",
          executable,
        ],
        folder,
        bunEnv,
      ),
    );
    const stepped = [bunExe(), join(import.meta.dir, "count-steps.ts"), executable];
    const { stdout, stderr } = await spawned(
      stepped,
      folder,
      { ...bunEnv, ...withSteadyCollections },
      limitOfSteppedRun,
    );
    const [, steps, marks] = /^steps (\d+) compiled \d+ marks (\d)$/m.exec(stderr) ?? [];
    if (marks !== "2" || !/^\d+ \w+ object\n$/.test(stdout))
      throw new Error(`${row.name}: no steps: ${stdout}${stderr}`.slice(0, 400));
    rmSync(folder, { recursive: true, force: true });
    return Number(steps);
  }
  const prices = new Map<Row, Promise<number>>();
  function priceOf(row: Row) {
    let price = prices.get(row);
    if (!price) {
      price = slot(async () => ((await stepsOf(row, 2 * items)) - (await stepsOf(row, items))) / items);
      prices.set(row, price);
    }
    return price;
  }

  test("every pin names a row", () =>
    expect(Object.keys(pins).filter(name => !rows.some(row => row.name === name))).toEqual([]));
  test.skipIf(mode === "update")("every row has a pin", () =>
    expect(rows.filter(row => !(row.name in pins)).map(row => row.name)).toEqual([]),
  );
  for (const row of rows)
    test.concurrent(
      row.name,
      async () => {
        const now = Math.round((await priceOf(row)) - (pushes(row) ? await priceOf(yardstick) : 0));
        const pin = mode === "update" ? undefined : pins[row.name];
        console.error(`FIRST EXECUTIONS ${row.name}\t${now}\t| pinned at\t${pin}`);
        if (pin === undefined) return void (written[row.name] = now);
        if (mode === "lower") written[row.name] = Math.min(pin, now);
        expect({ row: row.name, now, pin, isWorse: isWorse(now, pin) }).toEqual({
          row: row.name,
          now,
          pin,
          isWorse: false,
        });
      },
      900_000,
    );
});
