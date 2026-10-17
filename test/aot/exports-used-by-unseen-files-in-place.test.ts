// Run from its sources, a compiled module can be imported by a file that the build never saw: here one whose name is computed when the program runs.
// What that file hands to an exported typed function is an ordinary object. Where the function takes its parameter apart, `function f({ a, b, c = "c" }: T)`, the object cannot be
// named in the body, so all that may happen to it is what plain Bun does: the names of the pattern are read, by name, in the order written, once.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const part = `type Props = { a: string | readonly string[]; b: string; c?: string; d?: string; e?: boolean; n1?: number; n2?: number; k?: number };
const text = (a: string | readonly string[]): string => (typeof a === "string" ? a : a.join("+"));
let calls = 0;
function next(): string { calls++; return "made" + calls; }
export function label({ a, b, c = "c", d, e = false, n1 = 1, n2 }: Omit<Props, "k">): string { return text(a) + b + c + (d ?? "-") + e + (n1 + (n2 ?? 0)); }
export function few({ b, a }: Omit<Props, "k">): string { return b + text(a); }
export function callsForItsDefault({ a, b, c = next() }: Omit<Props, "k">): string { return text(a) + b + c; }
export function namesItByArguments({ a, b }: Omit<Props, "k">): string { return text(a) + b + (typeof arguments[0]) + arguments.length + Object.keys(arguments[0]).join(); }
export function withRest({ a, ...rest }: Omit<Props, "k">): string { return text(a) + Object.keys(rest).join(); }
export function nested({ a, inner: { x, y } }: { a: string; inner: { x: number; y: number; z1?: number; z2?: number; z3?: number }; o1?: number; o2?: number; o3?: number }): string { return a + (x + y); }
export function leavesARequiredOneOut({ a }: { a: string; must: number; o1?: number; o2?: number; o3?: number; o4?: number }): string { return a; }
export function ordinary(p: Omit<Props, "k">): string { return text(p.a) + p.b + (p.c ?? "c"); }
export function made(): string { return label({ a: "f", b: "g", c: "C", d: "D", e: true, n1: 1.5, n2: 2.5 }) + few({ a: ["f"], b: "g", c: "C", d: "D", e: true, n1: 1.5, n2: 2.5 }) + callsForItsDefault({ a: "f", b: "g", d: "D", e: true, n1: 1.5, n2: 2.5 }) + namesItByArguments({ a: "f", b: "g", c: "C", d: "D", e: true, n1: 1.5, n2: 2.5 }) + withRest({ a: "f", b: "g", c: "C", d: "D", e: true, n1: 1.5, n2: 2.5 }) + nested({ a: "f", inner: { x: 1, y: 2, z1: 1, z2: 2, z3: 3 }, o1: 1, o2: 2, o3: 3 }) + leavesARequiredOneOut({ a: "f", must: 1, o1: 1, o2: 2, o3: 3, o4: 4 }) + ordinary({ a: "f", b: "g", c: "C", d: "D", e: true, n1: 1.5, n2: 2.5 }); }
`;

const main = `declare const console: { log(...values: unknown[]): void };
declare const process: { argv: string[]; cwd(): string };
import { made } from "./part";
console.log(made());
const row: string = process.argv[2] ?? "none";
const plugin: { run(): unknown } = await import(process.cwd() + "/plugin-" + row + ".js");
try { console.log(String(plugin.run())); } catch (e) { console.log((e as Error).name + ": " + (e as Error).message.split("\\n")[0]); }
`;

const asPlainBun: Record<string, string> = {
  "two-members": `export function run() { return part.label({ a: "x", b: "y" }); }`,
  "other-order": `export function run() { return part.few({ a: "x", b: "y" }); }`,
  "getters": `export function run() { const log = []; const o = { get a() { log.push("a"); return "x"; }, get b() { log.push("b"); return "y"; }, get c() { log.push("c"); return undefined; }, get k() { log.push("k: NEVER"); return 1; }, get other() { log.push("other: NEVER"); return 1; } }; return [part.label(o), log.join(), part.few(o), log.join()]; }`,
  "proxy": `export function run() { const log = []; const traps = {}; for (const name of Object.getOwnPropertyNames(Reflect)) traps[name] = (...args) => { log.push(name + (typeof args[1] === "string" ? " " + args[1] : "")); return Reflect[name](...args); }; const o = new Proxy({ a: "x", b: "y" }, traps); return [part.label(o), log.join(), part.few(o), log.join()]; }`,
  "a-getter-throws": `export function run() { const log = []; const o = { get a() { log.push("a"); return "x"; }, get b() { log.push("b"); throw new RangeError("from b"); }, get c() { log.push("c: NEVER"); return "c"; } }; try { return part.label(o); } catch (e) { return [e.name, e.message, log.join()]; } }`,
  "frozen": `export function run() { const o = Object.freeze({ a: "x", b: "y" }); return [part.label(o), Object.isFrozen(o), Object.keys(o).join()]; }`,
  "class-instance": `export function run() { class Pair { a = "x"; b = "y"; get c() { return "got"; } } const o = new Pair(); return [part.label(o), o instanceof Pair, part.label(Object.create({ a: "p", b: "q" }))]; }`,
  "grows-later": `export function run() { const o = { a: "x", b: "y" }; const first = part.label(o); o.c = "later"; o.n2 = 5; o.zz = 1; return [first, part.label(o), Object.keys(o).join()]; }`,
  "more-members": `export function run() { return part.label({ zz: 1, a: "x", yy: 2, b: "y" }); }`,
  "nothing": `export function run() { try { return part.label(undefined); } catch (e) { return e.name; } }`,
};

// Still refused, and loudly. Whoever cures one of these moves its row up.
const stillRefused: Record<string, [why: string, body: string]> = {
  "default-calls": [
    "a default that calls a function would run behind the reads",
    `export function run() { return [part.callsForItsDefault({ a: "x", b: "y" }), part.callsForItsDefault({ a: "x", b: "y", c: "C" })]; }`,
  ],
  "arguments": [
    "the object can be named: arguments[0]",
    `export function run() { return part.namesItByArguments({ a: "x", b: "y" }); }`,
  ],
  "rest": [
    "a rest element makes an object of what is left",
    `export function run() { return part.withRest({ a: "x", b: "y" }); }`,
  ],
  "nested": [
    "a pattern within the pattern",
    `export function run() { return part.nested({ a: "x", inner: { x: 1, y: 2 } }); }`,
  ],
  "required-left-out": [
    "the pattern leaves out a required member of the type",
    `export function run() { return [part.leavesARequiredOneOut({ a: "x", must: 1 }), part.leavesARequiredOneOut({ a: "x" })]; }`,
  ],
  "ordinary": [
    "the parameter has a name: it can be kept, changed and compared",
    `export function run() { return part.ordinary({ a: "x", b: "y" }); }`,
  ],
};

const illTyped = `export function run() { return part.label({ a: 5, b: "y" }); }`;

const plugins = {
  ...asPlainBun,
  ...Object.fromEntries(Object.entries(stillRefused).map(([row, [, body]]) => [row, body])),
  "ill-typed": illTyped,
};
const files = {
  "part.ts": part,
  "main.ts": main,
  ...Object.fromEntries(
    Object.entries(plugins).map(([row, body]) => [`plugin-${row}.js`, `import * as part from "./part.ts";\n${body}\n`]),
  ),
};

async function run(cwd: string, args: string[]) {
  await using ran = Bun.spawn({ cmd: [bunExe(), ...args], cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, exitCode] = await Promise.all([ran.stdout.text(), ran.exited]);
  return { stdout, exitCode };
}

test.concurrent.each(Object.keys(asPlainBun))(
  "bun run --aot: a file that the build never saw calls an export that takes its parameter apart: %s",
  async row => {
    using dir = tempDir("aot-unseen-callers", files);
    const plain = await run(String(dir), ["run", "main.ts", row]);
    expect(plain.exitCode).toBe(0);
    expect(await run(String(dir), ["run", "--debug-aot", "main.ts", row])).toEqual(plain);
  },
  120_000,
);

test.concurrent.each(Object.keys(stillRefused))(
  "bun run --aot: a file that the build never saw is still refused, with a TypeError: %s",
  async row => {
    using dir = tempDir("aot-unseen-callers", files);
    const { stdout, exitCode } = await run(String(dir), ["run", "--debug-aot", "main.ts", row]);
    expect(stdout.trim().split("\n").at(-1)).toStartWith("TypeError: expected ");
    expect(exitCode).toBe(0);
  },
  120_000,
);

test("bun run --aot: a member that is not of its type is a TypeError that says so", async () => {
  using dir = tempDir("aot-unseen-callers", files);
  const { stdout, exitCode } = await run(String(dir), ["run", "--debug-aot", "main.ts", "ill-typed"]);
  expect(stdout.trim().split("\n").at(-1)).toStartWith("TypeError: expected string[] | string, got number 5");
  expect(exitCode).toBe(0);
}, 120_000);
