import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildFlags, compileCommand, runtimeEnvironment } from "./harness/flags";
import { built, slot, spawned } from "./run-programs";
import { describe, test } from "./supported";

const env = { ...bunEnv, NO_COLOR: "1" };
const rounds = 200_000;
const kept = 64;
const largeFields = Array.from({ length: 14 }, (_, index) => "f" + index);

const places = {
  makeSmall: "  return new Small(i, i + 1);",
  makeMedium: "  return { a: i, b: i + 1, c: i + 2, d: i + 3, e: i + 4 };",
  makeLarge: "  return new Large(i);",
  makeClosure: "  return () => i + 1;",
};

// A place is given the free lists that it uses up, so two places that took turns in one loop could leave everything to one
// of them. Here each place has a loop to itself, and whatever cell size it shares with another place, it uses up all the
// lists of its loop but the first and the last. What it makes stays in an array of the module for a while, so it is on the heap.
const source = `class Small {
  a: number;
  b: number;
  constructor(a: number, b: number) {
    this.a = a;
    this.b = b;
  }
}
class Large {
${largeFields.map(name => `  ${name}: number;`).join("\n")}
  constructor(seed: number) {
${largeFields.map((name, index) => `    this.${name} = seed + ${index};`).join("\n")}
  }
}
interface Medium {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
}
function makeSmall(i: number): Small {
${places.makeSmall}
}
function makeMedium(i: number): Medium {
${places.makeMedium}
}
function makeLarge(i: number): Large {
${places.makeLarge}
}
function makeClosure(i: number): () => number {
${places.makeClosure}
}
const smalls: Small[] = [];
const mediums: Medium[] = [];
const larges: Large[] = [];
const closures: (() => number)[] = [];
for (let i = 0; i < ${rounds}; i++) smalls[i % ${kept}] = makeSmall(i);
for (let i = 0; i < ${rounds}; i++) mediums[i % ${kept}] = makeMedium(i);
for (let i = 0; i < ${rounds}; i++) larges[i % ${kept}] = makeLarge(i);
for (let i = 0; i < ${rounds}; i++) closures[i % ${kept}] = makeClosure(i);
let sum = 0;
for (let k = 0; k < ${kept}; k++) sum += smalls[k].b + mediums[k].e + larges[k].f13 + closures[k]();
console.log(sum);
export {};
`;
const lineOf = (text: string) => source.split("\n").indexOf(text) + 1;

interface Allocation {
  function: string;
  position: string;
  layout: string;
  cells: number;
  bytes: number;
}

function parseAllocations(counts: string): Allocation[] {
  const lines = counts.split("\n").filter(line => line.startsWith("allocation"));
  expect(lines.filter(line => !/^allocation \S+ \S+ \S+ [1-9]\d* [1-9]\d*$/.test(line))).toEqual([]);
  return lines.map(line => {
    const [, name, position, layout, cells, bytes] = line.split(" ");
    return { function: name, position, layout, cells: Number(cells), bytes: Number(bytes) };
  });
}

// One list holds at most a block, 16 KB. A place loses the last list of its loop and the one in use at each collection.
const aboutAll = (cells: number) => (Math.abs(cells - rounds) <= rounds / 20 ? "about all" : cells);

async function countAllocations(folder: string, flags: string[]) {
  const executable = join(folder, isWindows ? "app.exe" : "app");
  const counts = join(folder, "counts.txt");
  built(await spawned([bunExe(), ...compileCommand, ...flags, "main.ts", "--outfile", executable], folder, env));
  const plain = await spawned([bunExe(), "main.ts"], folder, env);
  expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({
    stdout: expect.stringMatching(/^\d+\n$/),
    exitCode: 0,
  });
  const ran = await spawned([executable], folder, { ...env, [runtimeEnvironment.countsPath]: counts });
  expect(ran).toEqual({ stdout: plain.stdout, stderr: "", exitCode: 0, signal: null });
  return readFileSync(counts, "utf8");
}

describe.concurrent("allocation counts by site", () => {
  // TODO: the file of counts names no layout and counts no cell for any of the places.
  test.todo(
    "a run that writes counts names the function, the line and the layout of each place that allocates",
    () =>
      slot(async () => {
        using dir = tempDir("aot-allocation-counts", { "main.ts": source });
        const allocations = parseAllocations(await countAllocations(String(dir), []));

        const at = (name: keyof typeof places) =>
          allocations.filter(line => line.function === name && line.position === `main.ts:${lineOf(places[name])}`);
        const found = (name: keyof typeof places) => ({
          layouts: at(name).map(line => line.layout.replace(/^L\d+:/, "L:")),
          cells: aboutAll(at(name).reduce((cells, line) => cells + line.cells, 0)),
        });
        // An object that a constructor allocates stands under the place that says `new`, not under the constructor.
        expect({
          makeSmall: found("makeSmall"),
          makeMedium: found("makeMedium"),
          makeLarge: found("makeLarge"),
          makeClosure: found("makeClosure"),
        }).toEqual({
          makeSmall: { layouts: ["L:Small"], cells: "about all" },
          makeMedium: { layouts: [expect.stringMatching(/^L:\S+$/)], cells: "about all" },
          makeLarge: { layouts: ["L:Large"], cells: "about all" },
          makeClosure: { layouts: [expect.stringMatching(/^closure(:\S+)?$/)], cells: "about all" },
        });

        // The bytes are those of the cells in the heap, whose sizes are multiples of 16.
        expect(allocations.filter(line => line.bytes % (16 * line.cells))).toEqual([]);
        const cellSize = (name: keyof typeof places) => at(name)[0].bytes / at(name)[0].cells;
        expect(cellSize("makeSmall")).toBeLessThan(cellSize("makeMedium"));
        expect(cellSize("makeMedium")).toBeLessThan(cellSize("makeLarge"));

        const bytes = allocations.map(line => line.bytes);
        expect(bytes).toEqual(bytes.toSorted((a, b) => b - a));
      }),
    300_000,
  );

  test(
    "an obfuscated executable counts the same places and writes no name",
    () =>
      slot(async () => {
        using dir = tempDir("aot-allocation-counts-obfuscated", { "main.ts": source });
        const counts = await countAllocations(String(dir), [buildFlags.obfuscate]);
        const allocations = parseAllocations(counts);

        const words = allocations.map(line => `${line.function} ${line.position} ${line.layout}`);
        expect(words.filter(line => !/^(-|module) \d+:\d+ (L\d+:(object|-)|closure(:-)?|Map)$/.test(line))).toEqual([]);
        expect(allocations.filter(line => aboutAll(line.cells) === "about all")).toHaveLength(
          Object.keys(places).length,
        );
      }),
    300_000,
  );

  test(
    "an executable that counts branches counts every cell, by layout or by stub, and the same in every run",
    () =>
      slot(async () => {
        using dir = tempDir("aot-allocation-counts-exact", { "main.ts": source });
        const folder = String(dir);
        const allocations = parseAllocations(await countAllocations(folder, ["--aot-count-branches"]));
        const again = join(folder, "counts-again.txt");
        const ran = await spawned([join(folder, isWindows ? "app.exe" : "app")], folder, {
          ...env,
          [runtimeEnvironment.countsPath]: again,
        });
        expect(ran).toMatchObject({ stderr: "", exitCode: 0 });
        expect(parseAllocations(readFileSync(again, "utf8"))).toEqual(allocations);

        // No place is named: a stub counts the cell, under the layout where it knows one and under its own name elsewhere.
        expect(allocations.filter(line => line.function !== "-" || line.position !== "-")).toEqual([]);
        expect(allocations.filter(line => !/^(L\d+:\S+|closure|code|stub:\w+)$/.test(line.layout))).toEqual([]);
        const cells = (layout: RegExp) => allocations.filter(line => layout.test(line.layout)).map(line => line.cells);
        expect({ small: cells(/^L\d+:Small$/), large: cells(/^L\d+:Large$/) }).toEqual({
          small: [rounds],
          large: [rounds],
        });
        // Small, Medium and Large.
        expect(allocations.filter(line => line.layout.startsWith("L") && line.cells === rounds)).toHaveLength(3);
        // The modules of the run time make closures too.
        const closures = cells(/^(closure|stub:New\w*Closure)$/).reduce((sum, count) => sum + count, 0);
        expect(closures).toBeGreaterThanOrEqual(rounds);
        expect(closures).toBeLessThan(rounds + rounds / 20);
      }),
    300_000,
  );
});
