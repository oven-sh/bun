// Records whose number fields hold undefined or null are spread in a row.
interface O { a: number; b: number; c: number }
interface F { on: boolean; n: number }
function plain(): O { return { a: 1, b: 2, c: 3 }; }
function flags(): F { return { on: true, n: 4 }; }
function show(o: any): string {
  if (o === null || typeof o !== "object") return String(o);
  return "{" + Object.keys(o).map(k => k + ":" + (Object.is(o[k], -0) ? "-0" : String(o[k]))).join() + "}";
}
const makers: [string, () => any][] = [
  ["numbers", plain],
  ["undefined in a", () => { const o: any = plain(); o.a = undefined; return o; }],
  ["undefined in b", () => { const o: any = plain(); o.b = undefined; return o; }],
  ["null in c", () => { const o: any = plain(); o.c = null; return o; }],
  ["null in b, undefined in c", () => { const o: any = plain(); o.b = null; o.c = undefined; return o; }],
  ["nothing but null", () => { const o: any = plain(); o.a = null; o.b = null; o.c = null; return o; }],
  ["listed", () => ({ a: undefined, b: null, c: 3 })],
  ["a fraction and null", () => { const o: any = plain(); o.a = 0.5; o.b = null; return o; }],
  ["a text and undefined", () => { const o: any = plain(); o.a = "text"; o.c = undefined; return o; }],
  ["without b", () => { const o: any = plain(); delete o.b; o.c = null; return o; }],
];

function copiedThrice(p: O): O { p = { ...p }; p = { ...p }; p = { ...p }; return p; }
function copiedTwice(p: O): O { const q = { ...p }; return { ...q }; }
function oneMemberEach(p: O): O { p = { ...p, a: 1 }; p = { ...p, b: 2 }; return p; }
function lastMemberOnly(p: O): O { p = { ...p }; p = { ...p }; p = { ...p, c: 9 }; return p; }
function membersInFront(p: Partial<O>): O { const q = { a: 10, b: 20, c: 30, ...p }; return { ...q }; }
function membersInFrontRead(p: Partial<O>): string { const q: O = { a: 10, b: 20, c: 30, ...p }; return q.a + "," + q.b + "," + q.c; }
function added(p: O): string { const q = { ...p }; const r = { ...q }; return String(r.a + r.b + r.c); }
function addedOneByOne(p: O): string { const q = { ...p, a: 5 }; const r = { ...q }; return (r.a + 1) + "," + (r.b + 1) + "," + (r.c + 1); }
function tested(p: O): string {
  const q = { ...p }; const r = { ...q };
  return (r.a === undefined) + "," + (r.b === null) + "," + (r.c == null) + "," + typeof r.a + "," + typeof r.b + "," + typeof r.c + "," + (r.b ?? 7) + "," + (r.c ? "yes" : "no");
}
function asked(p: O): string { const q = { ...p }; const r = { ...q }; return ("a" in r) + "," + Object.hasOwn(r, "b") + "," + Object.keys(r).join("") + "," + JSON.stringify(r); }
function storedBehind(p: O): O { const q = { ...p }; const r = { ...q }; r.b = 8; return r; }
function storedBehindAndRead(p: O): string { const q = { ...p }; const r = { ...q }; r.c = r.a; return r.a + "," + r.b + "," + r.c; }
function eitherWay(p: O, f: boolean): O { let q: O; if (f) q = { ...p }; else q = { ...p, b: 6 }; return { ...q }; }
function eitherWayRead(p: O, f: boolean): string { let q: O; if (f) q = { ...p }; else q = { ...p, c: 6 }; const r = { ...q }; return r.a + "," + r.b + "," + r.c; }
function keptOnOneWay(p: O, f: boolean): O | string { const q = { ...p }; const r = { ...q }; if (f) return r; return r.b + "," + r.c; }
function against(p: O, f: boolean): string { const q = { ...p }; const r: O = f ? { ...q } : plain(); return r.a + "," + r.b + "," + r.c; }
function handedOn(p: O): string { const q = { ...p }; const r = { ...q }; return show(r) + show(q); }
function inList(p: O): string { const q = { ...p }; const list = [{ ...q }, { ...q, a: 2 }]; return show(list[0]) + show(list[1]); }
function inside(p: O): string { const q = { ...p }; const holder = { first: { ...q }, second: 2 }; return show(holder.first) + holder.second; }
function assigned(p: O): O { const q = Object.assign({}, p); return Object.assign({}, q) as O; }
function rest(p: O): string { const q = { ...p }; const { a, ...others } = q; return a + show(others); }
function turns(p: O, n: number): O { for (let i = 0; i < n; i++) { p = { ...p }; p = { ...p }; } return p; }
function sums(p: O, n: number): string { let s = 0; for (let i = 0; i < n; i++) { const q = { ...p }; const r = { ...q, a: i }; s += r.a + r.b + r.c; } return String(s); }
function counts(p: O, n: number): string { let s = 0; for (let i = 0; i < n; i++) { const q = { ...p }; const r = { ...q }; if (r.b == null) s++; if (r.c === null) s += 10; if (r.a === undefined) s += 100; } return String(s); }
function switched(p: F): F { p = { ...p }; p = { ...p }; return p; }
function switchedRead(p: F): string { const q = { ...p }; const r = { ...q }; return (r.on ? "on" : "off") + "," + (r.on === true) + "," + (r.n | 0) + "," + typeof r.on; }

function attempt(name: string, f: () => any): void {
  let out: string;
  try { const v = f(); out = typeof v === "string" ? v : show(v); } catch (e) { out = "threw " + (e as Error).message; }
  console.log(name + " = " + out);
}
for (let round = 0; round < 2; round++) {
  for (const [name, make] of makers) {
    console.log("## " + name);
    attempt("copiedThrice", () => copiedThrice(make()));
    attempt("copiedTwice", () => copiedTwice(make()));
    attempt("oneMemberEach", () => oneMemberEach(make()));
    attempt("lastMemberOnly", () => lastMemberOnly(make()));
    attempt("membersInFront", () => membersInFront(make()));
    attempt("membersInFrontRead", () => membersInFrontRead(make()));
    attempt("added", () => added(make()));
    attempt("addedOneByOne", () => addedOneByOne(make()));
    attempt("tested", () => tested(make()));
    attempt("asked", () => asked(make()));
    attempt("storedBehind", () => storedBehind(make()));
    attempt("storedBehindAndRead", () => storedBehindAndRead(make()));
    attempt("eitherWay t", () => eitherWay(make(), true));
    attempt("eitherWay f", () => eitherWay(make(), false));
    attempt("eitherWayRead t", () => eitherWayRead(make(), true));
    attempt("eitherWayRead f", () => eitherWayRead(make(), false));
    attempt("keptOnOneWay t", () => keptOnOneWay(make(), true));
    attempt("keptOnOneWay f", () => keptOnOneWay(make(), false));
    attempt("against t", () => against(make(), true));
    attempt("against f", () => against(make(), false));
    attempt("handedOn", () => handedOn(make()));
    attempt("inList", () => inList(make()));
    attempt("inside", () => inside(make()));
    attempt("assigned", () => assigned(make()));
    attempt("rest", () => rest(make()));
    attempt("turns", () => turns(make(), 3));
    attempt("sums", () => sums(make(), 4));
    attempt("counts", () => counts(make(), 4));
  }
  for (const make of [flags, () => { const o: any = flags(); o.on = undefined; return o; }, () => { const o: any = flags(); o.on = null; o.n = undefined; return o; }]) {
    attempt("switched", () => switched(make()));
    attempt("switchedRead", () => switchedRead(make()));
  }
}
let total = 0;
const sources: O[] = makers.slice(0, 6).map(([, make]) => make());
for (let i = 0; i < 30000; i++) {
  const r = copiedThrice(sources[i % sources.length]);
  if (r.b == null) total++;
  if (r.c === null) total += 3;
  total += Number(counts(sources[(i + 1) % sources.length], 2));
}
console.log("total " + total);
