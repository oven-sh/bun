// Loops whose elements of numbers are handed to a call or stored as they are: lists of int32s, of doubles, with holes, texts, large numbers, views and proxies.
// STATISTIC: LoopsUnswitched >= 2
// @ts-nocheck
let given: number[] = []; let calls = 0; const out: string[] = [];
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
  return [["ints", ints], ["doubles", doubles], ["mixed", mixed], ["large", large], ["edges", edges], ["zeros", zeros], ["holes", holes], ["holed", holed], ["values", values], ["longer", longer], ["own", own], ["view", view], ["floats", floats], ["proxy", proxy], ["frozen", frozen], ["getter", getter], ["named", named], ["sparse", sparse], ["empty", []], ["one", [7]], ["ints again", JSON.parse("[5,6,7,8,9,10]")]];
}
function show(v: any): string { return typeof v === "function" ? "function" : typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : typeof v === "object" && v ? "{" + Object.keys(v).map(k => k + ":" + show(v[k])).join() + "}" : typeof v + ":" + String(v); }
let lastOf0: any = 0; let flag0 = false; const holder0 = { last: 0 }, into0: number[] = [0, 0, 0, 0, 0, 0, 0, 0], kept0: number[] = [];
function go0(x: number): number { return x * 2; }
function change0(x: any): void { calls++; if (calls % 3 === 1) { given = [1.5, 2.5, 3.5]; } }
function run0(list: number[], n: number) { let s: any = 0, t = 0; for (let r = 0; r < 3; r++) { for (let k = n - 1; k >= 0; k--) { const x = list[k]!; s = (s + x) | 0; s = (s + go0(x)) | 0; } } return show(s) + " " + show(t); }
for (const way of [0, 1, 2]) for (const [name, list] of made()) {
  given = list; flag0 = way === 1; calls = way; lastOf0 = holder0.last = 0; kept0.length = 0;
  let r: string; try { r = run0(list, list.length); } catch (e: any) { r = "threw " + (e && e.message); }
  out.push("0 " + name + " " + way + " " + r + " " + [lastOf0, holder0.last, into0.join("/"), kept0.length, kept0.slice(0, 9).join("/"), (globalThis as any).G0].map(show).join(" ") + " " + calls);
}
let lastOf1: any = 0; let flag1 = false; const holder1 = { last: 0 }, into1: number[] = [0, 0, 0, 0, 0, 0, 0, 0], kept1: number[] = [];
const go1 = (x: number) => x - 1;
function change1(x: any): void { calls++; if (calls % 3 === 1) { given.push(0.5); } }
let list1: number[] = []; function run1(n: number) { const list = list1; let s: any = 0, t = 0; for (let k = 0; k < n + 1; k++) { const x = list[k]!; if (x > t) t = x; t = go1(x + 1); lastOf1 = x; } return show(s) + " " + show(t); }
for (const way of [0, 1, 2]) for (const [name, list] of made()) {
  given = list; flag1 = way === 1; calls = way; lastOf1 = holder1.last = 0; kept1.length = 0;
  let r: string; try { r = (list1 = list, run1(list.length)); } catch (e: any) { r = "threw " + (e && e.message); }
  out.push("1 " + name + " " + way + " " + r + " " + [lastOf1, holder1.last, into1.join("/"), kept1.length, kept1.slice(0, 9).join("/"), (globalThis as any).G1].map(show).join(" ") + " " + calls);
}
let lastOf2: any = 0; let flag2 = false; const holder2 = { last: 0 }, into2: number[] = [0, 0, 0, 0, 0, 0, 0, 0], kept2: number[] = [];
const go2: (x: number) => number = any.call > 5 ? x => x * 2 : x => x + 1;
function change2(x: any): void { calls++; if (calls % 3 === 1) { given[1] = "t" as any; } }
let list2: number[] = []; function run2(n: number) { const list = list2; let s: any = 0, t = 0; for (let k = 0; k < list.length; k++) { const x = list[k]!; lastOf2 = x; } return show(s) + " " + show(t); }
for (const way of [0, 1, 2]) for (const [name, list] of made()) {
  given = list; flag2 = way === 1; calls = way; lastOf2 = holder2.last = 0; kept2.length = 0;
  let r: string; try { r = (list2 = list, run2(list.length)); } catch (e: any) { r = "threw " + (e && e.message); }
  out.push("2 " + name + " " + way + " " + r + " " + [lastOf2, holder2.last, into2.join("/"), kept2.length, kept2.slice(0, 9).join("/"), (globalThis as any).G2].map(show).join(" ") + " " + calls);
}
console.log(out.join("\n"));
