// JSON.parse makes a record where the names in the text are the fields of a record that typed code takes. Each value goes straight into its slot.
// A boolean is as ordinary a value in JSON as a number, so a record with ten booleans may not cost much more to make than the same record with ten numbers in their place.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { measureCommand } from "./analysis-scaling/measure-check";
import { withSteadyCollections } from "./harness/counted-run";
import { built, spawned } from "./run-programs";
import { test } from "./supported";

const letters = [..."abcdefghij"];
const rest = [..."klmnopqr"];
const fieldsOf = (type: string, last: string) =>
  `id: number; ${letters.map(letter => `${letter}: ${type}`).join("; ")}; ${rest.map(letter => `${letter}: number`).join("; ")}; ${last}: number`;
const exampleOf = (value: string, last: string) =>
  `{ id: 0, ${letters.map(letter => `${letter}: ${value}`).join(", ")}, ${rest.map(letter => `${letter}: 0`).join(", ")}, ${last}: 0 }`;

const program = `declare const console: { log(...values: unknown[]): void };
declare const process: { argv: string[] };
const leak = new Function("value", process.argv.length > 99 ? "" : "return value");
function parse(text: string): any {
  return JSON.parse(text);
}
interface Flags { ${fieldsOf("boolean", "s")} }
interface Counts { ${fieldsOf("number", "t")} }
function sumFlags(rows: Flags[]): number {
  let sum = 0;
  for (const one of rows) sum += one.id + (one.a ? 1 : 0) + (one.j ? 2 : 0) + one.s;
  return sum;
}
function sumCounts(rows: Counts[]): number {
  let sum = 0;
  for (const one of rows) sum += one.id + one.a + one.j + one.t;
  return sum;
}
leak(${exampleOf("true", "s")} satisfies Flags);
leak(${exampleOf("0", "t")} satisfies Counts);
function textOf(last: string, value: (index: number) => string): string {
  const objects: string[] = [];
  for (let index = 0; index < 100; index++)
    objects.push(\`{"id":\${index},\${${JSON.stringify(letters)}.map(letter => \`"\${letter}":\${value(index)}\`).join(",")},\${${JSON.stringify(rest)}.map(letter => \`"\${letter}":\${index}\`).join(",")},"\${last}":1}\`);
  return \`[\${objects.join(",")}]\`;
}
const parsesFlags = process.argv[2] === "flags";
const text = parsesFlags ? textOf("s", index => (index & 1 ? "true" : "false")) : textOf("t", index => String(index & 1));
const turns = Number(process.argv[3]);
let sum = 0;
for (let turn = 0; turn < turns; turn++) sum += parsesFlags ? sumFlags(parse(text)) : sumCounts(parse(text));
console.log(sum > 0);
export {};
`;

const skipped =
  isDebug || isASAN
    ? "a debug or ASAN build counts other instructions"
    : isWindows
      ? "it counts with perf_event_open or /usr/bin/time -l"
      : undefined;
if (skipped) console.error(`SKIPPED: test/aot/parsed-records-of-booleans.test.ts: ${skipped}`);

test.skipIf(!!skipped)(
  "a record of booleans costs the parser about what a record of numbers costs",
  async () => {
    using dir = tempDir("aot-parsed-records-of-booleans", { "main.ts": program });
    const folder = String(dir);
    const executable = join(folder, "main");
    built(
      await spawned([bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", executable], folder, bunEnv),
    );
    const instructions = async (kind: string, turns: number) => {
      const run = await measureCommand(folder, [executable, kind, String(turns)], 120_000, {
        ...bunEnv,
        ...withSteadyCollections,
      });
      expect(run.stdout).toBe("true\n");
      return run.instructions;
    };
    // For one object: a text holds a hundred.
    const anObject = async (kind: string) => {
      const [few, many] = [await instructions(kind, 500), await instructions(kind, 2500)];
      return few === undefined || many === undefined ? undefined : Math.round((many - few) / 2000 / 100);
    };
    const [flags, counts] = [await anObject("flags"), await anObject("counts")];
    if (flags === undefined || counts === undefined)
      return void console.error("SKIPPED: instructions cannot be counted here");
    console.error(`PARSED RECORDS\tbooleans ${flags}\tnumbers ${counts}\tinstructions an object`);
    expect({ flags, counts, isWithinBounds: flags < counts * 1.25 }).toEqual({ flags, counts, isWithinBounds: true });
  },
  240_000,
);
