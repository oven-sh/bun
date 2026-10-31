// A store that may add a field to its object remembers what became of the keys of the last object it saw, in a table that all such
// stores of the program share. Only a store that takes objects of the same layout can find what another has left there.
//
// The program below has kinds of objects, each with names of its own, and ten loops a kind that each store one optional field. It is
// built with half as many stores as the table has entries, and with more stores than entries. The loops of the first kind take no
// more code in the larger program.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { built, slot, spawned, told } from "./harness/commands";
import { describe, test } from "./supported";

const fieldsOfKind = 10;

function programWith(kinds: number) {
  const lines: string[] = [];
  for (let kind = 0; kind < kinds; kind++) {
    const names = Array.from({ length: fieldsOfKind }, (_, field) => `k${kind}f${field}`);
    lines.push(
      `type T${kind} = { base${kind}: number; ${names.map(name => name + "?: number").join("; ")} };`,
      `function make${kind}(): T${kind} { return { base${kind}: ${kind} }; }`,
      ...names.map(
        (name, field) =>
          `function add${kind}_${field}(list: T${kind}[]): void { for (let i = 0; i < list.length; i++) list[i].${name} = ${field}; }`,
      ),
      `const adders${kind}: ((list: T${kind}[]) => void)[] = [${names.map((_, field) => `add${kind}_${field}`).join(", ")}];`,
      `function run${kind}(round: number): string { const list = [make${kind}(), make${kind}()]; for (let n = 0, j = round % ${fieldsOfKind}; n < ${fieldsOfKind}; n++, j = (j + 3) % ${fieldsOfKind}) adders${kind}[j](list); return Object.keys(list[1]).join(); }`,
    );
  }
  lines.push(
    `const runs: ((round: number) => string)[] = [${Array.from({ length: kinds }, (_, kind) => "run" + kind).join(", ")}];`,
    `for (let round = 0; round < 3; round++) for (let g = 0; g < runs.length; g++) { const keys = runs[g](round); if (g === 0) console.log(keys); }`,
  );
  return lines.join("\n") + "\n";
}

async function measure(kinds: number) {
  using dir = tempDir("aot-stores-that-add", { "program.ts": programWith(kinds) });
  const folder = String(dir);
  const report = join(folder, "report.json");
  const executable = join(folder, isWindows ? "program.exe" : "program");
  const flags = ["--aot-report=" + report, "--aot-report-detail=functions"];
  built(
    await spawned(
      [bunExe(), "build", "--compile", "--aot", ...flags, "./program.ts", "--outfile", executable],
      folder,
      bunEnv,
    ),
  );
  const { functions } = JSON.parse(readFileSync(report, "utf8")) as {
    functions: { name: string; codeBytes: number; operations?: Record<string, number> }[];
  };
  const ofFirstKind = functions.filter(({ name }) => name.startsWith("add0_"));
  return {
    output: told(await spawned([executable], folder, bunEnv)),
    codeBytes: ofFirstKind.reduce((sum, { codeBytes }) => sum + codeBytes, 0),
    storesThatMayAdd: functions.reduce((sum, { operations }) => sum + (operations?.PutSlotOrAdd ?? 0), 0),
  };
}

describe("compile/aot/a store that adds a field takes no more code in a larger program", () => {
  test("the loops of one kind of object, beside 99 other kinds and beside 219", async () => {
    const [small, large] = await Promise.all([slot(() => measure(100)), slot(() => measure(220))]);
    expect(large.output).toEqual(small.output);
    expect(small.storesThatMayAdd).toBeGreaterThanOrEqual(100 * fieldsOfKind);
    expect(large.storesThatMayAdd).toBeGreaterThanOrEqual(220 * fieldsOfKind);
    expect(small.codeBytes).toBeGreaterThan(0);
    expect(large.codeBytes).toBeLessThanOrEqual(small.codeBytes);
  }, 600_000);
});
