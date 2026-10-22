// A typed function that meets an object of another kind in the middle of its body goes on exactly where it was: nothing that ran runs again, nothing is skipped, every local keeps its value, and an object that was not made yet is made once.
// Every step of every body writes into a log, so a step that runs twice or not at all shows.
// The table: the form of the body x what the stranger is x which of the three typed parameters it is.
//
//   bun strangers-mid-function.ts <folder> [--sample=<how many>] [--only=<regex over names>]
//
// writes <folder>/mid-body-<form of the body>.ts.
import { writeCaseFiles, type CaseFile } from "./case-files";

const strangers: { name: string; text: string }[] = [
  { name: "the-class-itself", text: "new P()" },
  { name: "same-names-another-order", text: "new Q()" },
  { name: "a-literal", text: `{ v: 100, w: 200, m() { log.push("literal m"); return 300; } }` },
  {
    name: "getters-that-log",
    text: `{ get v() { log.push("get v"); return 5; }, set v(x) { log.push("set v " + x); }, get w() { log.push("get w"); return 6; }, set w(x) { log.push("set w " + x); }, m() { log.push("getters m"); return 7; } }`,
  },
  { name: "a-proxy", text: `new Proxy(new P(), { get(o, k, r) { log.push("trap get " + String(k)); return Reflect.get(o, k, r); }, set(o, k, x, r) { log.push("trap set " + String(k)); return Reflect.set(o, k, x, r); } })` },
  { name: "a-field-deleted", text: "(() => { const o: any = new P(); delete o.v; return o; })()" },
  { name: "reparented", text: `(() => { const o = new P(); Object.setPrototypeOf(o, { m() { log.push("other m"); return -3; } }); return o; })()` },
  { name: "frozen", text: "Object.freeze(new P())" },
  { name: "a-subclass", text: "new S()" },
  { name: "a-text-in-the-field", text: `(() => { const o: any = new P(); o.v = "text"; return o; })()` },
  { name: "null", text: "null" },
  { name: "undefined", text: "undefined" },
  { name: "a-number", text: "7" },
];

/** The body of `function run(a: P, b: P, c: P)`. `step(n)` logs n and answers n. */
const bodies: { name: string; text: string; kind?: "async" | "generator" }[] = [
  { name: "straight", text: "step(1); const x = a.v; step(2); const y = b.v; step(3); const z = c.v; step(4); return [x, y, z];" },
  { name: "arguments", text: "return list(step(1), a.v, step(2), b.v, step(3), c.m(), step(4));" },
  { name: "stores", text: "a.v = step(1); b.v = step(2); c.v = step(3); return [a.v, b.v, c.v];" },
  { name: "compound-stores", text: "a.v += step(1); b.v++; c.w *= step(2); --a.w; return [a.v, b.v, c.w, a.w];" },
  { name: "methods", text: "const x = a.m(); step(1); const y = b.m(); step(2); const z = c.m(); return [x, y, z];" },
  { name: "loop", text: "let total = 0; const all = [a, b, c, a]; for (let i = 0; i < all.length; i++) { step(i); total += all[i].v; step(10 + i); } return total;" },
  { name: "loop-with-a-local", text: "let total = 0, turns = 0; for (const each of [a, b, c]) { turns++; const before = total; total = before + each.v * turns; step(turns); } return [total, turns];" },
  { name: "try", text: `let x = 0, y = 0; try { step(1); x = a.v; step(2); y = b.m(); step(3); x += c.v; } catch (e) { log.push("caught " + (e as Error).name); } finally { step(4); } return [x, y];` },
  { name: "conditional", text: "const x = step(1) ? a.v : b.v; const y = step(0) ? a.w : b.w; const z = c.v > 0 ? step(2) : step(3); return [x, y, z];" },
  { name: "template", text: "return `${step(1)}${a.v}${step(2)}${b.v}${step(3)}${c.v}${step(4)}`;" },
  { name: "iterator-that-must-be-closed", text: "let total = 0; for (const each of closing([a, b, c])) { step(1); total += each.v; if (each.w > 100) break; } return total;" },
  { name: "destructuring", text: "const { v: x, w: y } = a; step(1); const { v: z } = b; step(2); const { w } = c; return [x, y, z, w];" },
  { name: "inner-function", text: "return inner(a) + inner(b) + inner(c);" },
  { name: "short-circuit", text: "return [a.v && step(1) && b.v && step(2) && c.v, a.w || step(3), b.w ?? step(4)];" },
  { name: "captured-local", text: "let n = 0; const count = () => ++n; count(); const x = a.v; count(); const y = b.v; count(); const z = c.v; return [n, x, y, z, count()];" },
  { name: "an-object-not-made-yet", text: "const made = { p: a.v, q: 0, r: [step(1)] }; made.q = b.v; step(2); return c.v > 0 ? made.p + made.q : made;" },
  { name: "an-object-that-gets-out-later", text: "const made = { p: a.v, q: 0 }; made.q = b.v; const z = c.v; kept.push(made); made.p++; return [z, kept[kept.length - 1] === made, made];" },
  { name: "fractions-in-locals", text: "let s = 0.5; s += a.v; s *= 3; s += b.v; s /= 7; s += c.v; return s;" },
  { name: "integers-in-locals", text: "let s = 2147483647 - a.v; s = (s + b.v) | 0; let u = s >>> 1; u += c.v; return [s, u];" },
  { name: "switch", text: "switch (a.v) { case 1: step(1); switch (b.v) { case 1: step(2); return c.v; default: step(3); return c.w; } default: step(4); return b.w; }" },
  { name: "await-between", text: "step(1); const x = a.v; await null; step(2); const y = b.v; await null; step(3); const z = c.v; return [x, y, z];", kind: "async" },
  { name: "yield-between", text: "step(1); const x = a.v; yield x; step(2); const y = b.v; yield y; step(3); const z = c.v; return [x, y, z];", kind: "generator" },
];

const places = { first: [true, false, false], second: [false, true, false], third: [false, false, true], all: [true, true, true] };

const head = `// A typed function meets an object of another kind in the middle of its body and goes on where it was: no step runs twice, none is skipped, every local keeps its value.
declare const console: { log(...values: unknown[]): void };
const show = (v: unknown) => JSON.stringify(v, (k, each) => each === undefined ? "undefined" : typeof each === "number" && each !== each ? "NaN" : typeof each === "function" ? "function" : each);
async function t(name: string, f: () => unknown) { let r; log.length = 0; try { r = show(await f()); } catch (e) { r = "threw " + (e as Error).name; } console.log(name, r, log.join(" ")); }
const log: (string | number)[] = [], kept: unknown[] = [];
const step = (n: number) => { log.push(n); return n; };
const list = (...all: unknown[]) => all;
class P { v = 1; w = 2; m() { log.push("m"); return 3; } }
class Q { w = 20; v = 10; m() { log.push("Q m"); return 30; } }
class S extends P { extra = 9; m() { log.push("S m"); return 33; } }
function inner(p: P) { log.push("in"); const r = p.v; log.push("out"); return r; }
function* closing(all: P[]) { try { for (const each of all) { log.push("next"); yield each; } } finally { log.push("closed"); } }
`;

function caseOf(body: (typeof bodies)[number], stranger: (typeof strangers)[number], place: keyof typeof places) {
  const call = `run(${places[place].map(isStranger => (isStranger ? "stranger()" : "new P()")).join(", ")})`;
  const [keyword, result] =
    body.kind === "async"
      ? ["async function", `await ${call}`]
      : body.kind === "generator"
        ? ["function*", `(() => { const steps = ${call}; const seen: unknown[] = []; let one = steps.next(); while (!one.done) { seen.push(one.value); one = steps.next(); } return [seen, one.value]; })()`]
        : ["function", call];
  const name = `${body.name} ${stranger.name} ${place}`;
  return { name, line: `await t("${name}", async () => { const stranger = (): any => (${stranger.text}); ${keyword} run(a: P, b: P, c: P) { ${body.text} } return ${result}; });` };
}

export const caseFiles = (): CaseFile[] =>
  bodies.map(body => ({
    name: `mid-body-${body.name}.ts`,
    head,
    cases: strangers.flatMap(stranger => (Object.keys(places) as (keyof typeof places)[]).map(place => caseOf(body, stranger, place))),
  }));

if (import.meta.main) writeCaseFiles(caseFiles());
