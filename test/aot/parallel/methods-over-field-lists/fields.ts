// Methods with a loop of a constant number of iterations over a list in a field, called in a loop: lists of every storage and shorter than the loop, left by break, return and throw, changed in the middle of the loop around.
// @ts-nocheck
let given: any[] = []; let calls = 0; const out: string[] = [];
const any: any = JSON.parse('{"call":1}');
function made(): [string, number[]][] {
  const ints: number[] = JSON.parse("[" + Array.from({ length: 24 }, (_, k) => (k * 37) % 101).join() + "]");
  const doubles: number[] = JSON.parse("[" + Array.from({ length: 24 }, (_, k) => ((k * 37) % 101) / 4).join() + "]");
  const mixed: number[] = JSON.parse('[1,2,3,"4",5,null,7]') as any;
  const large: number[] = JSON.parse("[2147483647,-2147483648,4294967295,1e300,9007199254740993,1,2]");
  const edges: number[] = JSON.parse("[2147483647,-2147483648,2147483646,-1,0,1]");
  const zeros: number[] = [0, -0, 1, NaN, Infinity, -Infinity];
  const holes: number[] = JSON.parse("[1,2,3,4,5,6,7,8]"); delete holes[4];
  const holed: number[] = JSON.parse("[1.5,2,3,4,5.5,6]"); delete holed[2];
  const values: number[] = [1, 2, { valueOf() { calls += 10; return 5; } } as any, 4, 5];
  const longer: number[] = JSON.parse("[1,2,3]"); longer.length = 6;
  class Own extends Array<number> {} const own: number[] = Own.from([4, 5, 6, 7]) as any;
  const view: number[] = new Int32Array([1, 2, 3, 4, 5]) as any; const floats: number[] = new Float64Array([1, 2.5, 3]) as any;
  const proxy: number[] = new Proxy([1, 2, 3, 4], { get(t: any, k) { if (k !== "length") calls++; return t[k]; } });
  const frozen: number[] = Object.freeze([3, 1, 4, 1, 5]) as any;
  const getter: number[] = [1, 2, 3, 4]; Object.defineProperty(getter, 2, { get() { calls += 3; return 30; }, configurable: true });
  const named: any = [1, 2, 3]; named.extra = 1;
  const sparse: number[] = [1, 2]; sparse[60] = 3;
  return [["ints", ints], ["doubles", doubles], ["mixed", mixed], ["large", large], ["edges", edges], ["zeros", zeros], ["holes", holes], ["holed", holed], ["values", values], ["longer", longer], ["own", own], ["view", view], ["floats", floats], ["proxy", proxy], ["frozen", frozen], ["getter", getter], ["named", named], ["sparse", sparse], ["empty", []], ["one", [7]], ["two", [7, 8]], ["two doubles", [1.5, 2.5]], ["objects", [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }, { x: 7, y: 8 }] as any], ["others", [{ x: 1, y: 2 }, { y: 4, x: 3 }, { x: 5 }, null] as any], ["ints again", JSON.parse("[5,6,7,8,9,10]")]];
}
function show(v: any): string { return typeof v === "function" ? "function" : typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : typeof v === "object" && v ? "{" + Object.keys(v).map(k => k + ":" + show(v[k])).join() + "}" : typeof v + ":" + String(v); }
let held0: number[] = [];  let flag0 = false; const holder0 = { last: 0 }, out30: number[] = [0, 0, 0, 0], other0: number[] = [1, 2, 3, 4]; let changes0 = 0;
function go0(x: number) { return x + 1; } function take0(p: { x: number; y: number }) { return p.x * 2 - p.y; }
function change0(x: any): void { calls++; if (changes0++ === 1) { given.length = 0; } }
class V0 { list: number[] = []; few0(r: number) { let s = 0; const x0 = 0; for (let i = 3; i >= 0; i--) { const p = this.list[i] as any as { x: number; y: number }; s += p.x; } return s; } } const box0 = new V0();
function run0(n: number) { const list = box0.list; let s = 0; const x0 = 0; for (let r = 0; r < n; r++) { if (r === 4) change0(r); s = (s + (box0 as any as V0).few0(r)) | 0; } return show(s); }
for (const way of [0, 1]) for (const n of [0, 1, 6]) for (const [name, list] of made()) {
  given = list; flag0 = way === 1; calls = 0; changes0 = 0; holder0.last = 0; out30.fill(0);
  let r: string; try { r = (box0.list = list as any, run0(n)); } catch (e: any) { r = "threw " + (e instanceof TypeError ? "TypeError" : e && e.message); }
  out.push("0 " + name + " " + way + " " + n + " " + r + " " + show(holder0.last) + " " + out30.map(show).join("/") + " " + calls);
}
let held1: number[] = [];  let flag1 = false; const holder1 = { last: 0 }, out31: number[] = [0, 0, 0, 0], other1: number[] = [1, 2, 3, 4]; let changes1 = 0;
function go1(x: number) { return x + 1; } function take1(p: { x: number; y: number }) { return p.x * 2 - p.y; }
function change1(x: any): void { calls++; if (changes1++ === 1) { given[1] = "t"; } }
class V1 { list: number[] = []; few1(r: number) { const list = this.list; let s = 0; const x0 = 0; for (let i = 0; i < 6; i++) { const x = list[i]!; s = (s + x) | 0; } return s; } } const box1 = new V1();
function run1(n: number) { const list = box1.list; let s = 0; const x0 = 0; for (let r = 0; r < n; r++) {  s = (s + (box1 as any as V1).few1(r)) | 0; } return show(s); }
for (const way of [0, 1]) for (const n of [0, 1, 6]) for (const [name, list] of made()) {
  given = list; flag1 = way === 1; calls = 0; changes1 = 0; holder1.last = 0; out31.fill(0);
  let r: string; try { r = (box1.list = list as any, run1(n)); } catch (e: any) { r = "threw " + (e instanceof TypeError ? "TypeError" : e && e.message); }
  out.push("1 " + name + " " + way + " " + n + " " + r + " " + show(holder1.last) + " " + out31.map(show).join("/") + " " + calls);
}
let held2: number[] = [];  let flag2 = false; const holder2 = { last: 0 }, out32: number[] = [0, 0, 0, 0], other2: number[] = [1, 2, 3, 4]; let changes2 = 0;
function go2(x: number) { return x + 1; } function take2(p: { x: number; y: number }) { return p.x * 2 - p.y; }
function change2(x: any): void { calls++; if (changes2++ === 1) { delete given[1]; } }
class V2 { list: number[] = []; few2(r: number) { const list = this.list; let s = 0; const x0 = 0; for (let i = 0; i < 12; i += 2) { const p = list[i] as any as { x: number; y: number }; s = (s + p.x - p.y) | 0; if (i === r) continue; s = (s + 1) | 0; } return s; } } const box2 = new V2();
function run2(n: number) { const list = box2.list; let s = 0; const x0 = 0; for (let r = 0; r < n; r++) {  s = (s + (box2 as any as V2).few2(r)) | 0; } return show(s); }
for (const way of [0, 1]) for (const n of [0, 1, 6]) for (const [name, list] of made()) {
  given = list; flag2 = way === 1; calls = 0; changes2 = 0; holder2.last = 0; out32.fill(0);
  let r: string; try { r = (box2.list = list as any, run2(n)); } catch (e: any) { r = "threw " + (e instanceof TypeError ? "TypeError" : e && e.message); }
  out.push("2 " + name + " " + way + " " + n + " " + r + " " + show(holder2.last) + " " + out32.map(show).join("/") + " " + calls);
}
console.log(out.join("\n"));
