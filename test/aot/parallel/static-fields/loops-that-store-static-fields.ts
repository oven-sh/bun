// Loops that store into static fields while nothing else reaches them, and what other code does to the fields between the loops and inside them.
// STATISTIC: StaticFieldGuardsHoisted >= 8
const trace: string[] = [];
const K: number = JSON.parse("6");
let amounts: any[] = [1, 2, 3];
class S {
  static v: number = 0;
  static w: number = 5;
  static z: number | null = null;
  static s: string = "x";
  static o: { a: number } = { a: 1 };
  static up(): number { S.v++; return S.v; }
  static own(): void { this.w--; }
}
class Heir extends S { static v: number = 100; }
function raises(): any { let n = 0; for (let i = 0; i < K; i++) { S.v++; n = (n + S.v) | 0; } return n; }
function stores(): any { let n = 0; for (let i = 0; i < K; i++) { S.v = i; n += S.v + S.w; } return n; }
function halves(): any { for (let i = 0; i < K; i++) S.v += i * 0.5; return S.v; }
function crosses(): any { let n = 0; for (let i = 0; i < K; i++) { S.v += S.w; S.w = S.v % 100; n += S.w; } return n; }
function calls(): any { let n = 0; for (let i = 0; i < K; i++) { n += S.up(); S.own(); } return n; }
function adds(): any { let n: any = 0; for (const x of amounts) { S.v += x; n += S.v; } return n; }
function objects(): any { let n = 0; for (let i = 0; i < K; i++) { S.o = { a: i + S.v }; n += S.o.a; S.s = S.s.length > 4 ? "" : S.s + "a"; } return n + S.s; }
function nothing(): any { let n = 0; for (let i = 0; i < K; i++) { S.z = i % 3 === 0 ? null : i; n += S.z ?? S.v; S.v++; } return n; }
function caught(): any { let n = 0; for (const x of amounts) { try { S.v++; if (x === 2) throw new RangeError("two"); n += S.v; } catch { S.w++; n += S.w; } } return n; }
function left(): any { for (let i = 0; i < K; i++) { S.v++; if (S.v > 8) return i; S.w = S.v; } return -1; }
const runs = [raises, stores, halves, crosses, calls, adds, objects, nothing, caught, left];
let kept: any = 9;
// Nothing that the compiler sees names the class here.
(globalThis as any).keptClass = S;
const key: string = JSON.parse('"v"'), other: string = JSON.parse('"w"');
function hidden(): any { return (globalThis as any)[JSON.parse('"keptClass"')]; }
const acts: [string, () => void][] = [
  ["none", () => {}],
  ["large", () => { hidden()[key] = 2147483645; }],
  ["fraction", () => { hidden()[key] = 0.5; }],
  ["negative zero", () => { hidden()[key] = -0; }],
  ["text", () => { hidden()[key] = "7"; }],
  ["undefined", () => { hidden()[key] = undefined; }],
  ["object", () => { hidden()[key] = { valueOf() { trace.push("v"); return 3; } }; }],
  ["amounts", () => { amounts = [1, { valueOf() { trace.push("a"); hidden()[key] = "t"; return 2; } }, 3]; }],
  ["deleting amounts", () => { amounts = [1, { valueOf() { delete hidden()[key]; return 2; } }, 3]; }],
  ["throwing amounts", () => { amounts = [1, { valueOf() { throw new TypeError("no"); } }, 3]; }],
  ["plain amounts", () => { amounts = [1, 2, 3]; }],
  ["deleted", () => { delete hidden()[key]; }],
  ["accessor", () => { Object.defineProperty(hidden(), key, { configurable: true, enumerable: true, get() { trace.push("g"); return kept; }, set(x) { trace.push("s"); kept = x; } }); }],
  ["read only", () => { Object.defineProperty(hidden(), key, { configurable: true, enumerable: true, value: 6, writable: false }); }],
  ["back", () => { Object.defineProperty(hidden(), key, { configurable: true, enumerable: true, value: 1, writable: true }); }],
  ["heir", () => { Heir.v++; Heir.w += 2; Heir.own(); }],
  ["assigned", () => { Object.assign(hidden(), { [key]: 4, more: 1 }); }],
  ["parent", () => { delete hidden()[other]; Object.setPrototypeOf(hidden(), { w: 60 }); }],
  ["sealed", () => { Object.seal(hidden()); }],
  ["frozen", () => { Object.freeze(hidden()); }],
];
const show = (v: any): string => typeof v === "object" && v !== null ? "o" : Object.is(v, -0) ? "-0" : typeof v + String(v);
const lines: string[] = [];
for (const [name, act] of acts) {
  act();
  for (const run of runs) {
    let answer: string;
    try { answer = show(run()); } catch (e: any) { answer = e.name; }
    const fields = ["v", "w", "z", "s"].map(key => { const d = Object.getOwnPropertyDescriptor(hidden(), key); return d ? (d.get ? "get" : show(d.value)) + +!!d.writable : "-"; });
    lines.push([name, run.name, answer, fields.join(), show(Heir.v), show(Heir.w), trace.splice(0).join("")].join(" "));
  }
}
console.log(lines.join("\n"));
export {};
