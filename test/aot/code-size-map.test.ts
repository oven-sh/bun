import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { built, slot, spawned } from "./harness/commands";
import { describe, test } from "./supported";

const source = `function half(n: number): number {
  return n / 2;
}

function fill(count: number): number[] {
  const list = [1];
  for (let i = 0; i < count; i++) list.push(half(i));
  return list;
}

const count = Number(process.argv[2] ?? 4);
console.log(fill(count).join(), { count, name: "count" });
`;
const files = { "app.ts": source, mapped: {}, unmapped: {} };

interface CompiledFunction {
  name: string;
  size: number;
  operations: { operation: string; form: string; values: number }[];
}

const env = { ...bunEnv, NO_COLOR: "1" };
const forms = ["Open", "Closed", "Generic"];

async function build(folder: string, output: string, flags: string[], map?: string) {
  const executable = join(folder, output, isWindows ? "app.exe" : "app");
  built(
    await spawned(
      [bunExe(), "build", "--compile", "--aot", ...flags, "app.ts", "--outfile", executable],
      folder,
      map ? { ...env, BUN_JSC_aotMapFilePath: map } : env,
    ),
  );
  return executable;
}

function groups(fields: string[], width: number) {
  expect(fields.length % width).toBe(0);
  return Array.from({ length: fields.length / width }, (_, index) => fields.slice(index * width, (index + 1) * width));
}

/** The functions of a map. Behind the row F of each stands its row FO, three columns an entry: an operation, the form of its code, how many values of it are so. */
function readMap(path: string) {
  const functions: CompiledFunction[] = [];
  let letterBefore = "";
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const [letter, ...fields] = line.split("\t");
    expect(letterBefore === "F").toBe(letter === "FO");
    if (letter === "F") functions.push({ name: fields[6], size: Number(fields[2]), operations: [] });
    if (letter === "FO")
      functions.at(-1)!.operations = groups(fields, 3).map(([operation, form, values]) => ({
        operation,
        form,
        values: Number(values),
      }));
    letterBefore = letter;
  }
  return functions;
}

describe.concurrent("the code size map", () => {
  test(
    "behind each function stand the operations that its code was made of, each with its form",
    () =>
      slot(async () => {
        using dir = tempDir("aot-code-size-map", files);
        const map = join(String(dir), "app.map");
        await build(String(dir), "mapped", [], map);
        const functions = readMap(map);
        expect(functions.map(({ name }) => name)).toContain("fill");
        expect(functions.filter(({ size }) => !(size > 0))).toEqual([]);

        const operations = functions.flatMap(({ operations }) => operations);
        expect(
          operations.filter(
            ({ operation, form, values }) =>
              !/^[A-Z][A-Za-z0-9]*$/.test(operation) || !forms.includes(form) || !(values > 0),
          ),
        ).toEqual([]);
        expect(operations.map(({ operation }) => operation)).toContain("NewObject");
        expect(functions.find(({ name }) => name === "fill")!.operations).toContainEqual({
          operation: "LoopHint",
          form: "Open",
          values: 1,
        });
      }),
    300_000,
  );

  test(
    "a TN row has the offset of a stub that never returns",
    () =>
      slot(async () => {
        using dir = tempDir("aot-code-size-map-stubs", files);
        const map = join(String(dir), "app.map");
        await build(String(dir), "mapped", [], map);
        const rows = readFileSync(map, "utf8")
          .split("\n")
          .map(line => line.split("\t"));
        const stubs = rows.filter(([letter]) => letter === "T");
        const neverReturning = rows.filter(([letter]) => letter === "TN");
        expect(neverReturning.filter(fields => fields.length !== 2)).toEqual([]);

        const offsets = new Set(neverReturning.map(([, offset]) => offset));
        expect([...offsets].filter(offset => !stubs.some(stub => stub[1] === offset))).toEqual([]);
        const names = stubs.filter(([, offset]) => offsets.has(offset)).map(([, , name]) => name);
        expect(names).toContain("HandleException");
        expect(names.filter(name => name.startsWith("PollAtPrologue"))).toEqual([]);
        expect(names.length).toBeLessThan(stubs.length);
      }),
    300_000,
  );

  test(
    "the map is written only on request, and writing it does not change the executable",
    () =>
      slot(async () => {
        using dir = tempDir("aot-code-size-map-unchanged", files);
        const map = join(String(dir), "app.map");
        const unmapped = await build(String(dir), "unmapped", []);
        expect(readdirSync(join(String(dir), "unmapped"))).toEqual([basename(unmapped)]);
        expect(existsSync(map)).toBe(false);

        const mapped = await build(String(dir), "mapped", [], map);
        expect(existsSync(map)).toBe(true);
        expect(readFileSync(mapped).equals(readFileSync(unmapped))).toBe(true);
      }),
    300_000,
  );
});
