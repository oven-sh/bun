// STATISTIC: LocalArrayMethodEffectsNarrowed >= 8
// For-of loops that push what they step, or numbers made of it, where nobody knows what is stepped: arrays of every storage, arrays with iterators of their own, sets, strings, generators, views, the array that is filled itself.
function shown(x: unknown): string { return typeof x === "number" ? (Object.is(x, -0) ? "-0" : String(x)) : typeof x === "object" && x !== null ? "object" : typeof x + ":" + String(x); }
function show(list: unknown[]): string { const parts: string[] = []; for (let i = 0; i < list.length; i++) parts.push(i in list ? shown(list[i]) : "hole"); return parts.join(","); }
const late = process.argv.length > 99 ? 1 : 0;
function veil(x: any[]): any[] { const all: any[][] = [x, [0]]; return all[late]!; }

const same = (list: any): string => { const more: any[] = []; for (const n of list) more.push(n); return show(more); };
function plus(list: any): string { const more: any[] = []; for (const n of list) more.push(n + 1); return show(more); }
function half(list: number[]): string { const more: number[] = []; for (const n of list) more.push(n * 0.5); return show(more); }
function twice(list: any): string { const more: any[] = []; for (const n of list) { more.push(n); more.push(n - 1); } return show(more); }
function above(list: number[]): string { const more: number[] = []; for (const n of list) if (n > 4) more.push(n); return show(more); }
function parted(list: any): string { const a: any[] = [], b: any[] = []; for (const n of list) { if (n > 4) a.push(n); else b.push(n); } return show(a) + "|" + show(b); }
function sums(list: number[]): string { const more: number[] = []; let s = 0; for (const n of list) { s += n; more.push(s); } return show(more); }
function worded(list: any): string { const more: string[] = []; for (const n of list) more.push(n > 4 ? "above" : "below"); return show(more); }
function objects(list: any): string { const more: { n: any }[] = []; for (const n of list) more.push({ n }); return show(more.map(m => m.n)); }
function stacked(list: any): string { const stack: any[] = []; let t: any = 0; for (const n of list) { if (n & 1 && stack.length > 1) t += stack.pop(); else stack.push(n); } return show(stack) + "|" + shown(t); }
function aliased(list: any): string { const more: any[] = [7]; const from = veil(more); let left = 9; for (const n of from) { if (left-- <= 0) break; more.push(n + 0.5); } for (const n of list) more.push(n); return show(more); }
function chosen(list: any): string { const more: any[] = Array.isArray(list) && list.length & 1 ? list : []; let left = 12; for (const n of list) { if (left-- <= 0) break; more.push(n); } return show(more); }
function grows(list: any): string { const more: any[] = []; for (const n of list) { more.push(n); if (Array.isArray(list) && list.length < 9) list.push(1.25); if (more.length > 20) break; } return show(more); }
let kept: any[] | undefined;
function escapes(list: any): string { const more: any[] = []; kept = undefined; for (const n of list) { more.push(n); if (more.length === 3) { kept = more; change(); } } return show(more); }
function change(): void { if (kept) kept[1] = "changed"; }
class Own extends Array { *[Symbol.iterator](): any { yield 1; yield 2.5; yield "x"; } }

const makers: [string, () => any][] = [
  ["ints", () => JSON.parse("[3,8,1,9,5,4,7,2,6]")],
  ["doubles", () => JSON.parse("[0.5,8.25,1.5,9.75,5.5,4.5]")],
  ["one fraction", () => JSON.parse("[3,8,1,9.5,5,4]")],
  ["NaN", () => { const l = JSON.parse("[3,8,1,9,5]"); l[3] = NaN; return l; }],
  ["undefined", () => { const l = JSON.parse("[3,8,1,9,5]"); l[2] = undefined; return l; }],
  ["hole", () => { const l = JSON.parse("[3,8,1,9,5]"); delete l[2]; return l; }],
  ["texts", () => JSON.parse('["3","8","x"]')],
  ["mixed", () => JSON.parse('[3,"8",2.5,null,true,{"a":1}]')],
  ["big", () => JSON.parse("[3,1099511627776,-9007199254740992,-0,1e400]")],
  ["object", () => [1, { valueOf() { change(); return 5; } }, 3]],
  ["empty", () => JSON.parse("[]")],
  ["frozen", () => Object.freeze(JSON.parse("[3,8.5,1]"))],
  ["own iterator", () => Own.from([4, 5, 6])],
  ["iterator on the array", () => { const l = JSON.parse("[3,8,1]"); l[Symbol.iterator] = function* () { yield 7; yield 8.5; }; return l; }],
  ["set", () => new Set([5, 6.5, 7])],
  ["map", () => new Map([["a", 5], ["b", 6.5]]).values()],
  ["string", () => "a5b"],
  ["generator", () => (function* () { yield 1; yield 2.5; yield "g"; })()],
  ["view", () => new Int16Array([5, 6, 7])],
  ["nothing", () => null],
  ["number", () => 5],
];
const forms = { same, plus, half, twice, above, parted, sums, worded, objects, stacked, aliased, chosen, grows, escapes };
for (const [form, run] of Object.entries(forms)) {
  for (const [name, make] of makers) {
    const said: string[] = [];
    for (let turn = 0; turn < 3; turn++) {
      try { said.push(run(make())); } catch (error) { said.push((error as Error).name); }
    }
    console.log(form, name, said.join(" / "));
  }
}
