declare function isString(x: unknown): x is string;
declare function assertNumber(x: unknown): asserts x is number;
declare function fail(): never;
type Shape = { kind: "circle"; r: number } | { kind: "square"; s: number } | { kind: "tri"; b: number; h: number };
function area(s: Shape): number {
  switch (s.kind) {
    case "circle": return s.r;
    case "square": return s.s;
  }
  const rest: { kind: "circle" } = s;
  return s.b * s.h;
}
function f1(x: string | number | undefined, y: unknown) {
  if (typeof x === "string") { const a: number = x; }
  else if (x !== undefined) { const b: string = x; }
  else { const c: string = x; }
  if (isString(y)) { const d: number = y; }
  assertNumber(y);
  const e: string = y;
  let z: string | number = 1;
  const g: string = z;
  z = "s";
  const h: number = z;
  while (z !== "done") { z = z === "s" ? 2 : "done"; const i: boolean = z; }
  let arr = [];
  arr.push(1); arr.push("a");
  const j: boolean[] = arr;
  let u;
  u = 1;
  const k: string = u;
  if (x) { fail(); const dead = 1; }
}
function f2(o: { a?: { b: string } } | null) {
  if (o?.a?.b) { const l: number = o.a.b; }
  const cond = typeof o === "object";
  if (cond && o) { const m: string = o; }
  if ("a" in (o ?? {})) { }
  const n: string = o!.a;
}
class A { x = 1 } class B { y = "" }
function f3(v: A | B) {
  if (v instanceof A) { const p: string = v; } else { const q: number = v; }
  if ("x" in v) { const r: string = v; }
}
function f4({ kind, ...r }: Shape, t: [1, string] | [2, number]) {
  const [tag, payload] = t;
  if (tag === 1) { const w: number = payload; }
}
let unassigned: string;
const used: string = unassigned;
