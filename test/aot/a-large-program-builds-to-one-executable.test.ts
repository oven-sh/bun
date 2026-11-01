// A build is a function of its sources and flags: one program, one executable, whatever the number of threads and however they fall.
// Analyses of the whole program run side by side, and each takes as long as the program is large, so this program is large: twelve
// hundred typed functions that any code may call, each of which hands closures to shared helpers and hands a value of unknown type and
// a function on to the next. ./repeated-builds.test.ts builds small programs far more often.
//
//   AOT_LARGE_PROGRAM_BUILDS=40 bun test test/aot/a-large-program-builds-to-one-executable    as many builds
import { expect, setDefaultTimeout } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "path";
import { withoutDebugInformation } from "./harness/commands";
import { compileCommand, withThreads } from "./harness/flags";
import { run } from "./harness/run";
import { wanted } from "./harness/shares";
import { describe, test } from "./supported";

setDefaultTimeout(1_200_000);

const modules = 40;
const functionsInModule = 30;
// Most builds have more threads than CI gives cores: a thread that waits for a core stops at other places than one that runs.
const threadCounts = [16, 1];

const helpers = `
export interface Item { id: number; name: string; weight: number; next?: Item; tags: string[] }
export function forEach<T, U>(list: readonly T[] | undefined, visit: (element: T, index: number) => U | undefined): U | undefined {
  if (list !== undefined) for (let index = 0; index < list.length; index++) { const result = visit(list[index], index); if (result) return result; }
  return undefined;
}
export function map<T, U>(list: readonly T[], change: (element: T, index: number) => U): U[] {
  const result: U[] = [];
  for (let index = 0; index < list.length; index++) result.push(change(list[index], index));
  return result;
}
export function filter<T>(list: readonly T[], keep: (element: T) => boolean): T[] {
  const result: T[] = [];
  for (const element of list) if (keep(element)) result.push(element);
  return result;
}
export function reduce<T, U>(list: readonly T[], join: (sum: U, element: T) => U, start: U): U {
  let sum = start;
  for (const element of list) sum = join(sum, element);
  return sum;
}
export function once<T>(make: () => T): T { return make(); }
export function orElse<T>(value: T | undefined, make: () => T): T { return value === undefined ? make() : value; }
export function twice<T>(value: T, change: (value: T) => T): T { return change(change(value)); }
`;

function bodyOf(module: number, index: number): string {
  return [
    `reduce(map(items, (item, at) => item.weight * ${index + 1} + at), (sum: number, weight) => sum + weight, 0)`,
    `filter(items, item => item.id % ${index + 2} === 0).length + (forEach(items, item => (item.name.length > ${index % 9} ? item.id : undefined)) ?? 0)`,
    `once(() => items.length * ${index + 3}) + orElse(items[${index % 4}]?.next?.id, () => depth)`,
    `twice(depth, value => value + reduce(items, (sum: number, item) => sum + item.tags.length, ${index}))`,
    `map(filter(items, item => item.weight > ${index % 5}), item => item.name + "${index}").join("").length`,
    `orElse(forEach(items, (item, at) => (at === ${index % 6} ? item.weight : undefined)), () => once(() => ${index}))`,
    `reduce(items, (sum: number, item) => sum + twice(item.id, id => id + ${index % 3}), 0)`,
  ][(module * 7 + index) % 7];
}

function moduleText(module: number): string {
  const names = Array.from({ length: functionsInModule }, (_, index) => `run${module}_${index}`);
  const isLast = module + 1 === modules;
  return (
    `import { type Item, filter, forEach, map, once, orElse, reduce, twice } from "./helpers.ts";\n` +
    (isLast ? "" : `import { run${module + 1}_0 } from "./module${module + 1}.ts";\n`) +
    names
      .map((name, index) => {
        const next = index + 1 < functionsInModule ? names[index + 1] : isLast ? "" : `run${module + 1}_0`;
        return (
          `export function ${name}(items: Item[], depth: number, extra: unknown, change: (value: number) => number): number {\n` +
          `  const here = change(${bodyOf(module, index)}) + (extra === depth ? 1 : 0);\n` +
          `  return here + ${next ? `${next}(items, depth + 1, extra, change)` : "depth"};\n}\n`
        );
      })
      .join("") +
    `(globalThis as any).registry ??= [];\n(globalThis as any).registry.push(${names.join(", ")});\n`
  );
}

const sources: Record<string, string> = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      strict: true,
      target: "esnext",
      module: "esnext",
      moduleResolution: "bundler",
      allowImportingTsExtensions: true,
      noEmit: true,
      types: [],
    },
  }),
  "helpers.ts": helpers,
  "main.ts":
    `import type { Item } from "./helpers.ts";\nimport { run0_0 } from "./module0.ts";\n` +
    `declare const console: { log(...values: unknown[]): void };\n` +
    `const made: Item[] = [];\n` +
    `for (let id = 0; id < 8; id++) made.push({ id, name: "n" + id, weight: id * 1.5, tags: ["a", "b"].slice(0, id % 3) });\n` +
    `const items = JSON.parse(JSON.stringify(made)) as Item[];\n` +
    `console.log(run0_0(items, 0, JSON.parse("1"), value => value + 1));\n`,
};
for (let module = 0; module < modules; module++) sources[`module${module}.ts`] = moduleText(module);

// A debug build or one with ASAN takes many minutes for each.
describe.skipIf(wanted === "quick" || isASAN || isDebug)("compile/aot/a large program builds to one executable", () => {
  test("the same bytes at every number of threads", async () => {
    using folder = tempDir("aot-a-large-program", sources);
    const builds = Number(process.env.AOT_LARGE_PROGRAM_BUILDS) || threadCounts.length;
    const found = new Map<string, number[]>();
    let next = 0;
    // Two at a time: they disturb each other.
    const lane = async (number: number) => {
      // An executable holds its own name, so all have one name, each in a folder of its lane.
      const executable = join(String(folder), "out", String(number), isWindows ? "program.exe" : "program");
      mkdirSync(join(String(folder), "out", String(number)), { recursive: true });
      for (let build = next++; build < builds; build = next++) {
        const threads = threadCounts[build % threadCounts.length];
        const built = await run(
          [
            bunExe(),
            ...compileCommand,
            withThreads(threads),
            ...withoutDebugInformation(),
            "./main.ts",
            "--outfile",
            executable,
          ],
          String(folder),
        );
        const outcome =
          built.exitCode === 0
            ? new Bun.CryptoHasher("sha256").update(await Bun.file(executable).bytes()).digest("hex")
            : `exit code ${built.exitCode} ${built.stderr.slice(-600)}`;
        found.set(outcome, [...(found.get(outcome) ?? []), threads]);
        rmSync(executable, { force: true });
      }
    };
    await Promise.all([lane(0), lane(1)]);
    expect(
      [...found].map(([outcome, threads]) => ({
        outcome: /^[0-9a-f]{64}$/.test(outcome) ? "built" : outcome,
        builds: threads.length,
      })),
    ).toEqual([{ outcome: "built", builds }]);
  });
});
