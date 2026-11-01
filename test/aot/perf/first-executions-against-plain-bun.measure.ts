// Each row of ./first-executions.ts as an executable and as plain Bun runs the same two files, by the processor's counter: instructions an item, all threads.
// Plain Bun parses the item, makes its bytecode and interprets it, once: the compiler did that part at the build. No row may cost more compiled than plain.
// As counted on Linux x64, compiled | plain: a class and its first instance 1,713 | 124,883 . a constructor function with two methods and its first instance 10,677 | 122,263 .
// the first object of a layout 664 | 25,629 . the first object of a site whose layout other sites share 21 | 17,087 . a function declaration taken as a value 18 | 21,413 .
// a getter defined on the exports 188 | 53,184 . a name stored on an object that the build knows nothing of 645 | 14,673 . the keys of the one object of a layout 1,595 | 38,769 .
// a pattern 612 | 7,501 . a Set of three strings 356 | 20,982 . a short string 695 | 1,478.
import { expect } from "bun:test";
import { rmSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, tempDir } from "harness";
import { join } from "path";
import { measureCommand } from "../analysis-scaling/measure-check";
import { built, slot, spawned, withoutDebugInformation } from "../harness/commands";
import { withSteadyCollections } from "../harness/counted-run";
import { describe, test } from "../supported";
import { pushes, rows, writeProgram, yardstick, type Row } from "./first-executions";

const items = 250;
const skipped = isDebug || isASAN ? "a debug or ASAN build counts other instructions" : !isLinux ? "instructions are counted on Linux" : undefined;
if (skipped) console.error(`SKIPPED: test/aot/perf/first-executions-against-plain-bun.measure.ts: ${skipped}`);

describe.skipIf(!!skipped)("compile/aot/perf/first-executions-against-plain-bun", () => {
  const root = String(tempDir("aot-first-executions-against-plain-bun", {}));
  const env = { ...bunEnv, ...withSteadyCollections };
  type Price = { compiled: number; plain: number } | undefined;

  async function countsOf(row: Row, count: number) {
    const folder = join(root, `${[yardstick, ...rows].indexOf(row)}-${count}`);
    const entry = writeProgram(folder, row, count, { marks: false });
    const executable = join(folder, "main");
    built(await spawned([bunExe(), "build", "--compile", "--aot", ...withoutDebugInformation(), entry, "--outfile", executable], folder, bunEnv));
    const compiled = await measureCommand(folder, [executable], 300_000, env);
    const plain = await measureCommand(folder, [bunExe(), "run", entry], 300_000, env);
    expect(compiled.stdout).toBe(plain.stdout);
    rmSync(folder, { recursive: true, force: true });
    return { compiled: compiled.instructions, plain: plain.instructions };
  }
  const prices = new Map<Row, Promise<Price>>();
  function priceOf(row: Row) {
    let price = prices.get(row);
    if (!price) {
      price = slot(async () => {
        const [few, many] = [await countsOf(row, items), await countsOf(row, 2 * items)];
        if (few.compiled === undefined || few.plain === undefined || many.compiled === undefined || many.plain === undefined) return undefined;
        return { compiled: (many.compiled - few.compiled) / items, plain: (many.plain - few.plain) / items };
      });
      prices.set(row, price);
    }
    return price;
  }

  for (const row of rows)
    test.concurrent(
      row.name,
      async () => {
        const [now, push] = [await priceOf(row), await priceOf(yardstick)];
        if (!now || !push) return void console.error(`SKIPPED: ${row.name}: instructions cannot be counted here`);
        const less = pushes(row) ? push : { compiled: 0, plain: 0 };
        const [compiled, plain] = [Math.round(now.compiled - less.compiled), Math.round(now.plain - less.plain)];
        console.error(`FIRST EXECUTIONS AGAINST PLAIN BUN ${row.name}\t${compiled}\t| plain\t${plain}`);
        expect({ row: row.name, compiled, plain, isDearer: compiled > plain }).toEqual({ row: row.name, compiled, plain, isDearer: false });
      },
      900_000,
    );
});
