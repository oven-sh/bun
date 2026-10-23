import { expect, test } from "bun:test";
import { existsSync } from "fs";
import { bunExe, isCI } from "harness";
import { join } from "path";
import { findBuiltinTable, generators } from "./generate";
import { rows, units, unitsOf } from "./parts.mts";
import { unsupported } from "./run-programs";

const asked = process.env.TEST_PART?.replaceAll("\\", "/").replace(/^test\//, "");
const wanted = asked?.replace(/\.test\.ts$/, "");
// A row without parts may have the name of a row with parts. The runner asks for a unit by the name of its file.
const isOneUnit = asked !== wanted;

for (const row of wanted === undefined ? [] : rows) {
  const [name, parts, module, callee, before = [], behind = []] = row;
  for (const [index, unit] of unitsOf(row).entries())
    if (wanted === unit || (!isOneUnit && (wanted === name || wanted === "all")))
      await (await import(module))[callee](...before, ...(parts ? [index + 1, parts, ...(behind[index] ?? [])] : []));
}

if (wanted === undefined) {
  test("no unit has the name of a test file", () => {
    expect(units.filter(unit => existsSync(join(import.meta.dir, "..", unit)))).toEqual([]);
  });

  test("every folder that a script writes is run", () => {
    const run = Object.keys(generators).filter(
      folder =>
        rows.some(([name]) => name === `aot/${folder}`) || existsSync(join(import.meta.dir, `${folder}.test.ts`)),
    );
    expect(run).toEqual(Object.keys(generators));
  });

  // Without it the programs that follow from it are skipped, sixteen thousand of them, and nothing else would be red.
  test.skipIf(!isCI || !!unsupported)("CI has packed the table of built-ins beside the Bun under test", () => {
    expect(findBuiltinTable(bunExe())).toBeDefined();
  });
}
