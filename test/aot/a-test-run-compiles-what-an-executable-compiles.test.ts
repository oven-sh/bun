// `bun test --aot` is there to say whether the executable works, so it has to run the executable's code. Each program here is built twice: as an
// executable, and as a test file that imports it. The compiler's map lists every function it made: where it is written, its name, which form of it
// (typed, generic ..) and how many bytes. The two lists of the program's own files have to be the same.
//
// What may differ, and why, is one table: docs/compiler/debugging.mdx, "What differs from an executable".
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildEnvironment } from "./harness/flags";
import { describe, test } from "./supported";

const lib = `
export const LIMIT = 4;
export function add(a: number, b: number): number { return (a + b) | 0; }
export class Point {
  constructor(public x: number, public y: number) {}
  length(): number { return Math.sqrt(this.x * this.x + this.y * this.y); }
}
`;

const programs: Record<string, { files: Record<string, string>; differsToday?: string }> = {
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
    differsToday: "every file may be taken out of require.cache, so each keeps its state in six more bytes",
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
  for (const [title, { files, differsToday }] of Object.entries(programs)) {
    // `failing`: it turns red the day the two agree. Then take the reason out.
    (differsToday ? test.failing : test)(title, async () => {
      const folder = String(
        tempDir("aot-both-ways", {
          ...files,
          "entry.ts": `import "./main.ts";\n`,
          "entry.test.ts": `import { test } from "bun:test";\nimport "./main.ts";\ntest("runs", () => {});\n`,
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
        return ownFunctions(join(folder, map), Object.keys(files));
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
      expect(testRun).toEqual(executable);
    });
  }
});
