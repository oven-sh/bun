import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// a.test.ts imports late.ts, late.ts imports early.ts, and early.ts imports late.ts back: the body of early.ts runs first and uses what late.ts DECLARES.
// JavaScript makes the functions that a module declares when the graph is linked, so they are there. In a test run a file may load again, and then it keeps what it
// does not export in an environment of the run, which such a function holds. The body used to make both: early.ts found nothing, and the run died of a fault or threw.
// `vi.resetModules()` behind a test that never holds makes every file one that may load again. Each shape is a project of its own: beside others a fault can hide.
const testFile = `import { test, vi } from "bun:test";
import * as late from "./late";
test("a", () => {
  console.log("SEEN", JSON.stringify(late.report()));
  if (process.argv.length > 99) vi.resetModules();
});
`;

const shapes: Record<string, Record<string, string>> = {
  "a-class-is-still-in-its-dead-zone": {
    "early.ts": `import { f } from "./late";
export const seen = (() => { try { return f(); } catch (error) { return String(error); } })();
`,
    "late.ts": `import { seen } from "./early";
export class C { x = 1; }
export function f() { return new C().x; }
export const report = () => [seen, f()];
`,
  },
  "a-var-with-an-initializer-is-stored-over-what-an-early-call-left": {
    "early.ts": `import { f } from "./late";
export const seen = [f(), f()];
`,
    "late.ts": `import { seen } from "./early";
var count = 100;
export function f() { count = (count ?? 0) + 1; return count; }
export const report = () => [seen, f()];
`,
  },
  "an-exported-const-is-still-in-its-dead-zone": {
    "early.ts": `import { f, shown } from "./late";
export const seen = [(() => { try { return f(); } catch (error) { return String(error); } })(), (() => { try { return shown; } catch (error) { return String(error); } })()];
`,
    "late.ts": `import { seen } from "./early";
export const shown = 3;
const kept = 4;
export function f(touches = false) { return touches ? kept : shown; }
export const report = () => [seen, f(), f(true)];
`,
  },
  "async-function": {
    "early.ts": `import { f } from "./late";
export const seen = [typeof f, f() instanceof Promise];
`,
    "late.ts": `import { seen } from "./early";
const kept = 1;
export async function f(touches = false) { return touches ? kept : "async"; }
export const report = () => [seen];
`,
  },
  "calls-another-declared-function-that-is-not-exported": {
    "early.ts": `import { f } from "./late";
export const seen = f();
`,
    "late.ts": `import { seen } from "./early";
const kept = 1;
function helper(touches: boolean) { return touches ? kept : "helper"; }
export function f(touches = false) { return helper(touches); }
export const report = () => [seen, f(true)];
`,
  },
  "captures-nothing": {
    "early.ts": `import { f } from "./late";
export const seen = f();
`,
    "late.ts": `import { seen } from "./early";
export function f() { return "nothing"; }
export const report = () => [seen, f()];
`,
  },
  "declared-in-a-block-is-not-hoisted-out-of-it": {
    "early.ts": `import { f } from "./late";
export const seen = f();
`,
    "late.ts": `import { seen } from "./early";
const kept = 1;
export function f() { return typeof inner; }
{ function inner() { return kept; } }
export const report = () => [seen, f()];
`,
  },
  "default-export": {
    "early.ts": `import f from "./late";
export const seen = f();
`,
    "late.ts": `import { seen } from "./early";
const kept = 1;
export default function f(touches = false) { return touches ? kept : "default"; }
export const report = () => [seen, f(true)];
`,
  },
  "exported-under-another-name": {
    "early.ts": `import { g } from "./late";
export const seen = g();
`,
    "late.ts": `import { seen } from "./early";
const kept = 1;
function f(touches = false) { return touches ? kept : "renamed"; }
export { f as g };
export const report = () => [seen, f(true)];
`,
  },
  "generator-function": {
    "early.ts": `import { f } from "./late";
export const seen = [...f()];
`,
    "late.ts": `import { seen } from "./early";
const kept = 1;
export function* f(touches = false) { yield touches ? kept : "first"; yield "second"; }
export const report = () => [seen, [...f(true)]];
`,
  },
  "gets-a-property-early": {
    "early.ts": `import { f } from "./late";
(f as any).mark = "marked early";
export const seen = Object.keys(f);
`,
    "late.ts": `import { seen } from "./early";
const kept = 1;
export function f() { return kept; }
export const report = () => [seen, (f as any).mark, f()];
`,
  },
  "is-the-same-function-early-and-late": {
    "early.ts": `import { f } from "./late";
export const early = f;
`,
    "late.ts": `import { early } from "./early";
const kept = 1;
export function f() { return kept; }
export const report = () => [early === f, typeof early, early()];
`,
  },
  "loaded-again-under-a-query": {
    "a.test.ts": `import { test, vi } from "bun:test";
import * as late from "./late";
test("a", async () => {
  console.log("SEEN", JSON.stringify(late.report()));
  const again = await import("./late?again");
  console.log("SEEN", JSON.stringify(again.report()), again.f === late.f);
  console.log("SEEN", JSON.stringify(late.report()));
  if (process.argv.length > 99) vi.resetModules();
});
`,
    "early.ts": `import { f } from "./late";
export const seen = f();
`,
    "late.ts": `import { seen } from "./early";
const kept = { runs: 0 };
export function f(touches = false) { return touches ? ++kept.runs : "query"; }
export const report = () => [seen, f(true)];
`,
  },
  "names-a-const-and-does-not-touch-it": {
    "early.ts": `import { f } from "./late";
export const seen = f();
`,
    "late.ts": `import { seen } from "./early";
const kept = new Map<string, number>();
export function f(touches = false) { return touches ? kept.size : 7; }
export const report = () => [seen, f(true)];
`,
  },
  "namespace-handed-on": {
    "early.ts": `import * as late from "./late";
const call = (all: any, name: string) => all[name]();
export const seen = call(late, "f");
`,
    "late.ts": `import { seen } from "./early";
const kept = 1;
export function f(touches = false) { return touches ? kept : "handed on"; }
export const report = () => [seen, f(true)];
`,
  },
  "re-exported-by-a-barrel": {
    "barrel.ts": `export { f } from "./late";
export * from "./late";
`,
    "early.ts": `import { f } from "./barrel";
export const seen = f();
`,
    "late.ts": `import { seen } from "./early";
const kept = 1;
export function f(touches = false) { return touches ? kept : "barrel"; }
export const report = () => [seen, f(true)];
`,
  },
  "read-off-the-namespace": {
    "early.ts": `import * as late from "./late";
export const seen = late.f();
`,
    "late.ts": `import { seen } from "./early";
const kept = 1;
export function f(touches = false) { return touches ? kept : "namespace"; }
export const report = () => [seen, f(true)];
`,
  },
  "reads-and-writes-a-var": {
    "early.ts": `import { f } from "./late";
export const seen = [f(), f()];
`,
    "late.ts": `import { seen } from "./early";
var count: number | undefined;
export function f() { const before = count; count = (count ?? 0) + 1; return String(before); }
export const report = () => [seen, f(), count];
`,
  },
  "the-body-names-it-too": {
    "early.ts": `import { f } from "./late";
export const early = f;
`,
    "late.ts": `import { early } from "./early";
const kept = 1;
export function f() { return kept; }
const own = f;
const list = [f, f];
export const report = () => [early === own, list[0] === list[1], own()];
`,
  },
  "through-a-third-file-that-the-first-does-not-import": {
    "early.ts": `import { viaMiddle } from "./middle";
export const seen = viaMiddle();
`,
    "late.ts": `import { seen } from "./middle";
const kept = 1;
export function f(touches = false) { return touches ? kept : "late"; }
export const report = () => [seen, f(true)];
`,
    "middle.ts": `import { seen as first } from "./early";
import { f } from "./late";
const own = 2;
export function viaMiddle(touches = false) { return touches ? own : f(); }
export const seen = [first, viaMiddle(true)];
`,
  },
  "top-level-await-in-the-early-file": {
    "early.ts": `import { f } from "./late";
await Promise.resolve();
export const seen = f();
`,
    "late.ts": `import { seen } from "./early";
const kept = 1;
export function f(touches = false) { return touches ? kept : "awaited"; }
export const report = () => [seen, f(true)];
`,
  },
  "touches-a-const-in-its-dead-zone": {
    "early.ts": `import { f } from "./late";
export const seen = (() => { try { return f(); } catch (error) { return String(error); } })();
`,
    "late.ts": `import { seen } from "./early";
const kept = 5;
export function f() { return kept; }
export const report = () => [seen, f()];
`,
  },
  "two-test-files-load-the-cycle": {
    "b.test.ts": `import { test, vi } from "bun:test";
import * as late from "./late";
test("b", () => {
  console.log("SEEN", JSON.stringify(late.report()));
  if (process.argv.length > 99) vi.resetModules();
});
`,
    "early.ts": `import { f } from "./late";
export const seen = f();
`,
    "late.ts": `import { seen } from "./early";
const kept = { runs: 0 };
export function f(touches = false) { return touches ? ++kept.runs : "two"; }
export const report = () => [seen, f(true)];
`,
  },
};

for (const [name, files] of Object.entries(shapes)) {
  test.concurrent(`a function that a file on a cycle declares, used ahead of its body: ${name}`, async () => {
    using dir = tempDir("aot-declared-on-a-cycle", {
      "package.json": `{ "name": "p", "type": "module" }`,
      "a.test.ts": testFile,
      ...files,
    });
    const seenWith = async (...flags: string[]) => {
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
      return {
        lines: stdout.split("\n").filter(line => line.startsWith("SEEN")),
        failed: stderr.split("\n").filter(line => /^\(fail\)|^✗|^panic|Error/.test(line)),
        exitCode,
      };
    };
    const [plain, compiled] = await Promise.all([seenWith(), seenWith("--aot")]);
    expect(plain.lines.length).toBeGreaterThan(0);
    expect(plain.exitCode).toBe(0);
    expect(compiled).toEqual(plain);
  }, 120_000);
}
