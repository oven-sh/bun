// `bun test --aot` is there to say whether the executable works, so it has to run the executable's code. Each program here is built twice: as an
// executable, and as a test file that imports it. The compiler's map lists every function it made: where it is written, its name, which form of it
// (typed, generic ..) and how many bytes. The two lists of the program's own files have to be the same.
//
// What may differ, and why, is one table: docs/compiler/debugging.mdx, "What differs from an executable".
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { buildEnvironment } from "./harness/flags";
import { describe, test } from "./supported";

// supported.ts sets the limit for the first file of a process alone.
raiseDefaultTimeout(120_000);

const lib = `
export const LIMIT = 4;
export function add(a: number, b: number): number { return (a + b) | 0; }
export class Point {
  constructor(public x: number, public y: number) {}
  length(): number { return Math.sqrt(this.x * this.x + this.y * this.y); }
}
`;

type Program = {
  files: Record<string, string>;
  /** In the place of a test file that only imports main.ts. */
  testFile?: string;
  /** The files that the test file asks to be compiled in another way. The others have to be the executable's. */
  opened?: string[];
  differsToday?: string;
};

const programs: Record<string, Program> = {
  "one file that imports and exports nothing": {
    files: {
      "main.ts": `
function add(a: number, b: number): number { return (a + b) | 0; }
class Point {
  constructor(public x: number, public y: number) {}
  length(): number { return Math.sqrt(this.x * this.x + this.y * this.y); }
}
function sum(n: number): number { let total = 0; for (let i = 0; i < n; i++) total = add(total, i); return total; }
const counters = [1, 2, 3].map(step => { let count = 0; return () => (count += step); });
console.log(sum(Number(process.argv.length) + 1000), new Point(3, 4).length(), counters.map(next => next() + next()).join());
`,
    },
  },
  "calls, a class and a constant of another file": {
    files: {
      "lib.ts": lib,
      "main.ts": `
import { add, Point, LIMIT } from "./lib.ts";
export function sum(n: number): number { let total = 0; for (let i = 0; i < n; i++) total = add(total, i); return total; }
export function far(n: number): number { return new Point(n, LIMIT).length(); }
console.log(sum(1000), far(3));
`,
    },
  },
  "a namespace object that goes somewhere, and no spy that could take it": {
    files: {
      "lib.ts": lib,
      "again.ts": `export * as lib from "./lib.ts";`,
      "main.ts": `
import * as whole from "./lib.ts";
import { lib } from "./again.ts";
export function sum(n: number): number { let total = 0; for (let i = 0; i < n; i++) total = whole.add(total, i); return total; }
export function far(n: number): number { return new lib.Point(n, lib.LIMIT).length(); }
const late = await import("./lib.ts");
console.log(sum(1000), far(3), Object.keys(whole).join(), [lib, late].length);
`,
    },
  },
  "a namespace object that goes somewhere, and a spy on some object under a name that nothing exports": {
    files: {
      "lib.ts": lib,
      "again.ts": `export * as lib from "./lib.ts";`,
      "main.ts": `
import * as whole from "./lib.ts";
import { lib } from "./again.ts";
export function sum(n: number): number { let total = 0; for (let i = 0; i < n; i++) total = whole.add(total, i); return total; }
export function far(n: number): number { return new lib.Point(n, lib.LIMIT).length(); }
const late = await import("./lib.ts");
console.log(sum(1000), far(3), Object.keys(whole).join(), [lib, late].length);
`,
    },
    testFile: `
import { expect, spyOn, test } from "bun:test";
import "./main.ts";
test("spies", () => {
  const doors = [{ open() { return 1; } }];
  const spy = spyOn(doors[0], "open").mockReturnValue(2);
  expect(doors[0].open()).toBe(2);
  spy.mockRestore();
});
`,
  },
  "a package that defines toString on the prototype of what it is handed": {
    files: {
      "node_modules/failures/package.json": `{ "name": "failures", "version": "1.0.0", "type": "module", "main": "index.js" }`,
      "node_modules/failures/index.js": `
const done = new WeakSet([Object.prototype, Error.prototype]);
export function describe(failure) {
  const proto = Object.getPrototypeOf(failure);
  if (done.has(proto)) return failure;
  done.add(proto);
  Object.defineProperty(proto, "toString", { configurable: true, value() { return "failure: " + this.message; } });
  return failure;
}
`,
      "main.ts": `
import { describe } from "failures";
class Failure { constructor(public message: string) {} }
function join(parts: unknown[]): string { let text = ""; for (const part of parts) text += String(part) + \`\${part}\`; return text; }
console.log(join([describe(new Failure("one")), {}, [1, 2], () => 3, 4]));
`,
    },
  },
  "CommonJS files that require each other": {
    files: {
      "shapes.cjs": `
exports.area = function area(width, height) { return width * height; };
exports.Box = class Box { constructor(side) { this.side = side; } volume() { return exports.area(this.side, this.side) * this.side; } };
`,
      "sums.cjs": `
const { area } = require("./shapes.cjs");
module.exports = function total(sides) { let sum = 0; for (const side of sides) sum += area(side, side); return sum; };
`,
      "main.ts": `
const shapes = require("./shapes.cjs");
const total = require("./sums.cjs");
console.log(total([1, 2, 3]), new shapes.Box(2).volume(), (await import("./sums.cjs")).default([4]));
`,
    },
  },
  "a test takes one file out of require.cache, and the others are not touched": {
    files: {
      "lib.ts": lib,
      "counter.ts": `export let loads = ((globalThis as any).loads = ((globalThis as any).loads ?? 0) + 1);\nexport function twice(n: number): number { return n * 2; }`,
      "uses-counter.ts": `import { twice } from "./counter.ts";\nexport function four(n: number): number { return twice(twice(n)); }`,
      "main.ts": `
import { add, Point, LIMIT } from "./lib.ts";
export function sum(n: number): number { let total = 0; for (let i = 0; i < n; i++) total = add(total, i); return total; }
export function far(n: number): number { return new Point(n, LIMIT).length(); }
const late = await import("./lib.ts");
console.log(sum(1000), far(3), late.add(1, 2), (await import("./uses-counter.ts")).four(1));
`,
    },
    testFile: `
import { expect, test } from "bun:test";
import "./main.ts";
test("loads again", async () => {
  delete require.cache[require.resolve("./counter.ts")];
  expect((await import("./counter.ts")).loads).toBe(2);
});
`,
    // Whatever imports a file that loads again may be bound to the new instance.
    opened: ["counter.ts", "uses-counter.ts", "main.ts"],
  },
  "a function of one of Bun's own modules": {
    files: {
      "main.ts": `
import { basename, join } from "node:path";
function name(folder: string, file: string): string { return basename(join(folder, file), ".ts"); }
console.log(name("a/b", "c.ts"), name("d", "e.ts"));
`,
    },
  },
};

/** `position name form bytes` of each function of the program's own files. */
function ownFunctions(mapPath: string, files: string[]): string[] {
  const rows = readFileSync(mapPath, "latin1").split("\n");
  const functions = rows.map(row => row.split("\t")).filter(columns => columns[0] === "F");
  return functions
    .flatMap(columns => {
      const file = files.find(name => (columns[10] ?? "").endsWith("/" + name));
      return file ? [`${file}:${columns[11]} ${columns[7]} ${columns[8]} ${columns[3]}`] : [];
    })
    .sort();
}

// The map is written on every platform. The forms are the same there, the bytes are not worth a second look.
describe.skipIf(isWindows)("compile/aot/a-test-run-compiles-what-an-executable-compiles", () => {
  for (const [title, { files, testFile, opened = [], differsToday }] of Object.entries(programs)) {
    // `failing`: it turns red the day the two agree. Then take the reason out.
    (differsToday ? test.failing : test)(title, async () => {
      const folder = String(
        tempDir("aot-both-ways", {
          ...files,
          "entry.ts": `import "./main.ts";\n`,
          "entry.test.ts":
            testFile ?? `import { test } from "bun:test";\nimport "./main.ts";\ntest("runs", () => {});\n`,
        }),
      );
      const build = async (map: string, ...command: string[]) => {
        const env = { ...bunEnv, [buildEnvironment.mapFilePath]: join(folder, map) };
        await using child = Bun.spawn({
          cmd: [bunExe(), ...command],
          cwd: folder,
          env,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [out, err, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
        expect({ out, err, exitCode }).toEqual({ out: expect.any(String), err: expect.any(String), exitCode: 0 });
        const compared = Object.keys(files).filter(file => !opened.includes(file));
        return ownFunctions(join(folder, map), compared);
      };
      const executable = await build(
        "executable.map",
        "build",
        "--compile",
        "--aot",
        "./entry.ts",
        "--outfile",
        "program",
      );
      const testRun = await build("test-run.map", "test", "--aot", "./entry.test.ts");
      expect(executable).not.toBeEmpty();
      // A file that loads again comes from disk, so the loader of the run time has to find the others: each has a few bytes more for that.
      if (opened.length) expect(executable.filter(it => !testRun.includes(it))).toEqual([]);
      else expect(testRun).toEqual(executable);
    });
  }
});
