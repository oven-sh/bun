declare function assert(x: unknown): asserts x;
declare function dec(t: any, k?: any): any;
const enum CE { A = 1 }
namespace NS { export const v = 1; export namespace Inner { export const w = ""; } }
class P {
  #priv = 1; auto; static sauto; declare amb: string;
  static { this.sauto = ""; }
  constructor(public q: number, o?: P) { this.auto = 1; const a: string = this.auto; if (o && #priv in o) { const b: string = o; } }
  protected pm() { return 1; }
  m(this: P, x = this.q) { return x; }
}
class Q2 extends P { n() { const f = (p: P) => p.pm(); return super.pm(); } }
function g1(x: string | number | boolean | { k: 1 } | undefined, y: { a?: { b: number } }, z: unknown) {
  switch (typeof x) { case "string": { const a: number = x; break; } case "number": case "boolean": { const b: string = x; break; } default: { const c: string = x; } }
  switch (true) { case typeof x === "string": { const d: number = x; break; } case x === undefined: { const e: number = x; break; } }
  assert(typeof z === "string" && z.length > 0); const f: number = z;
  if (y.a?.b === 1) { const h: string = y.a; }
  if (z.constructor === String) { }
  const isS = typeof x === "string"; if (isS === true) { const i: number = x; }
  if (x == null) { const j: string = x; }
  for (const key in y) { const k: number = key; }
  const [p1, [p2] = [x], ...p3] = [1, ["s"], true]; const l: string = p3;
  let w; [w, { w }] = [1, { w: "s" }] as const; const m: boolean = w;
  ({ a: w = 2 } = { a: undefined }); const n: string = w;
}
const ie = [].map<string>; const ie2 = Array<string>; const ie3: number = ie2;
const ce = CE; const ce2 = CE.A; const ns: number = NS.Inner.w; const ns2 = NS.Inner?.["w"].x;
const dyn = import("./nope"); const dyn2 = import(1);
const nn = (undefined as string | undefined)!.length?.toFixed().foo;
function over2(cb: (x: string) => void): void; function over2(cb: (x: number, y: number) => void, n: number): void; function over2(...a: any[]) {}
over2((x, y) => {}); over2(x => x.toFixed());
const cond = Math.random() ? (x: number) => x : undefined; const cr: string = cond?.(1);
async function aw(p: Promise<number> | string) { const r: boolean = await p; for await (const v of [p]) {} }
function* gen(): Generator<number, string, boolean> { const s: string = yield 1; return 1; }
label: while (true) { continue label; }
var v1 = 1, v2 = v1 ?? 2, v3 = !v1 ? 1 : 2, v4 = v1 === 1 || v1 === 2;
let tup: [a: number, b?: string] = [1]; tup = [1, "s", 3]; const [, second = 1] = tup; const s2: string = second;
