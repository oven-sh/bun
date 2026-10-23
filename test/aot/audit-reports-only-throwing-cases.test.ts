import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const tsconfig = `{ "compilerOptions": { "strict": true, "target": "ESNext", "module": "Preserve", "noEmit": true, "types": [] } }`;
const mismatches = (stderr: string) => stderr.split("\n").filter(line => line.startsWith("[aot] type-mismatch "));

test("the callers are named whatever the folder is called", async () => {
  using dir = tempDir("aot-audit-demo aot_audit audit-preload", {
    "tsconfig.json": tsconfig,
    "main.ts": `export {};
function double(n: number): number { return n * 2; }
const untyped: any = double;
function calls(): void { try { untyped("x"); } catch {} }
calls();
`,
  });
  const { stderr, exitCode } = await run([bunExe(), "run", "--aot-log-type-mismatches", "main.ts"], String(dir));
  expect(mismatches(stderr).map(line => line.replace(/^.*; from /, ""))).toEqual([
    expect.stringMatching(/^main\.ts:4 < main\.ts/),
  ]);
  expect(exitCode).toBe(0);
}, 120_000);

test("a file in a folder is named with forward slashes, and so are the callers", async () => {
  using dir = tempDir("aot-audit-folders", {
    "tsconfig.json": tsconfig,
    "src/deep/main.ts": `export {};
function double(n: number): number { return n * 2; }
const untyped: any = double;
function calls(): void { try { untyped("x"); } catch {} }
calls();
`,
  });
  const { stderr, exitCode } = await run(
    [bunExe(), "run", "--aot-log-type-mismatches", "src/deep/main.ts"],
    String(dir),
  );
  const records = mismatches(stderr);
  expect(records.map(line => line.split(" ")[4])).toEqual(["src/deep/main.ts:2:17"]);
  expect(records.map(line => line.replace(/^.*; from /, ""))).toEqual([
    expect.stringMatching(/^src\/deep\/main\.ts:4 < src\/deep\/main\.ts/),
  ]);
  expect(exitCode).toBe(0);
}, 120_000);

// A line of `--aot-log-type-mismatches` names a location where a value does not match its declared type. A new prototype is no such value.
test("Object.setPrototypeOf on records and on an instance", async () => {
  using dir = tempDir("audit-reports-only-throwing-cases", {
    "tsconfig.json": tsconfig,
    "main.ts": `declare const console: { log(...values: unknown[]): void };
function seal<T extends object>(value: T): T { Object.setPrototypeOf(value, null); return Object.freeze(value); }
function adopt<T extends object>(value: T, parent: object): T { return Object.setPrototypeOf(value, parent); }
type Timer = { cancel(): void; readonly id: number };
const sealed: Timer = seal({ cancel() {}, id: 1 });
console.log("sealed", Object.getPrototypeOf(sealed), sealed.id);
try { const adopted: Timer = adopt({ cancel() {}, id: 2 }, { other: 1 }); console.log("adopted", adopted.id); } catch (e) { console.log("adopted", (e as Error).name); }
class Point { x = 1; }
const things: any[] = [new Point()];
function strip(value: any, parent: object | null): void { Object.setPrototypeOf(value, parent); }
try { strip(things[0], null); console.log("an instance", things[0].x); } catch (e) { console.log("an instance", (e as Error).name); }
function double(n: number): number { return n * 2; }
const untyped: any = double;
try { console.log("a string", untyped("x")); } catch (e) { console.log("a string", (e as Error).name); }
`,
  });
  const said: Record<string, { stdout: string; lines: string[]; exitCode: number }> = {};
  for (const flags of [[], ["--aot"], ["--aot-log-type-mismatches"]]) {
    const { stdout, stderr, exitCode } = await run([bunExe(), "run", ...flags, "main.ts"], String(dir));
    said[flags.join()] = {
      stdout,
      lines: mismatches(stderr).map(line =>
        line.replace(
          /^\[aot\] type-mismatch [0-9a-f]{12} (\S+ \S+ \(.*?\)): .*; (continued|dropped); count .*$/,
          "$1 $2",
        ),
      ),
      exitCode,
    };
  }
  expect(said[""]).toEqual({
    stdout: "sealed null 1\nadopted 2\nan instance 1\na string NaN\n",
    lines: [],
    exitCode: 0,
  });
  expect(said["--aot"]).toEqual(said[""]);
  expect(said["--aot-log-type-mismatches"]).toEqual({
    ...said[""],
    lines: ["argument main.ts:12:17 (double) continued"],
  });
}, 120_000);
