import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

test.each(["--aot-audit", "--aot"])("the callers are named whatever the folder is called: %s", async flag => {
  using dir = tempDir("aot-audit-demo aot_audit audit-preload", {
    "tsconfig.json": `{ "compilerOptions": { "strict": true, "target": "ESNext", "module": "Preserve", "noEmit": true, "types": [] } }`,
    "main.ts": `export {};
function double(n: number): number { return n * 2; }
const untyped: any = double;
function calls(): void { try { untyped("x"); } catch {} }
calls();
`,
  });
  await using proc = Bun.spawn({ cmd: [bunExe(), "run", flag, "main.ts"], cwd: String(dir), env: { ...bunEnv, BUN_AOT_TYPE_ERROR_LOG: "stderr" }, stdout: "pipe", stderr: "pipe" });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr.split("\n").filter(line => line.startsWith("[aot] type-error ")).map(line => line.replace(/^.*; from /, ""))).toEqual([expect.stringMatching(/^main\.ts:4 < main\.ts/)]);
  expect(exitCode).toBe(0);
});

// A line of `--aot-audit` that says would-throw names a place where `bun run --aot` and the executable throw.
test("Object.setPrototypeOf on records and on an instance", async () => {
  using dir = tempDir("audit-reports-only-throwing-cases", {
    "tsconfig.json": `{ "compilerOptions": { "strict": true, "target": "ESNext", "module": "Preserve", "noEmit": true, "types": [] } }`,
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
`,
  });
  const said: Record<string, { stdout: string; lines: string[]; exitCode: number }> = {};
  for (const flag of ["--aot", "--aot-audit"]) {
    await using proc = Bun.spawn({ cmd: [bunExe(), "run", flag, "main.ts"], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    said[flag] = { stdout, lines: stderr.split("\n").filter(line => line.includes("object-set-prototype")).map(line => line.replace(/^.*object-set-prototype /, "").replace(/; count.*$/, "")), exitCode };
  }
  expect(said["--aot"]).toEqual({ stdout: "sealed null 1\nadopted 2\nan instance TypeError\n", lines: [], exitCode: 0 });
  expect(said["--aot-audit"]).toEqual({ stdout: "sealed null 1\nadopted 2\nan instance 1\n", lines: ["main.ts:10:66 (strip): on Point; would-throw"], exitCode: 0 });
});
