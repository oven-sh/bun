// Loops that are unswitched on flags of every kind: the flag is off, on, or turned over by what the loud side calls or by valueOf.
// STATISTIC: LoopsUnswitched >= 6
// @ts-nocheck
let calls = 0; const out: string[] = []; const sink: any[] = [];
const ints: number[] = JSON.parse("[" + Array.from({ length: 64 }, (_, k) => (k * 37) % 101).join() + "]");
const doubles: number[] = JSON.parse("[" + Array.from({ length: 64 }, (_, k) => ((k * 37) % 101) / 4).join() + "]");
const odd: number[] = JSON.parse('[1,2,3,"4",5,null,7]') as any;
const few: number[] = JSON.parse("[3,1,2]");
const none: number[] = JSON.parse("[]");
const holes: number[] = JSON.parse("[1,2,3,4,5,6,7,8]"); delete holes[4];
const values: number[] = [1, 2, { valueOf() { calls += 10; turn(); return 5; } } as any, 4, 5];
let turn: () => void = () => {};
const lists: [string, number[]][] = [["ints", ints], ["doubles", doubles], ["few", few], ["none", none], ["odd", odd], ["holes", holes], ["values", values], ["ints", ints]];
const any: any = JSON.parse('{"call":1}');
function show(v: any): string { return typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : typeof v + ":" + String(v); }
const g36 = { level: any.call > 9 ? 0 : 2, name: "a" }; 
function tell36(...a: any[]): number { calls++; sink.push(a[a.length - 1]); if (sink.length > 20) sink.length = 0; if (calls % 7 === 3) { ints[3] = 1.5; ints[3] = 7; } return calls; }
const on36: Record<string, any[]> = { x: [(v: any) => tell36(v)] };
function emit36(name: string, x: any) { const hs = on36[name]; if (!hs) return 0; for (const h of hs) h(x); return 1; }
function note36(x: number): number { return g36.level < 1 ? tell36(x) & 3 : 5; }
function run36(list: number[], n: number) { let s = 0, t = 0, best = -1; const keep: number[] = [], o = { last: 0 }, count = [0, 0, 0, 0, 0, 0, 0, 0]; for (let i = 0; i < n; i += 2) { const x = list[i]!; if (x > best) best = x; if (g36.level < 1) { s = (s + tell36("x", x)) | 0; } if (x > 90) t++; } return [s, t, best, keep.length, o.last, count.join("")].map(show).join(" "); }
for (const [name, list] of lists) for (const way of [0, 1, 2]) {
  g36.level = 2;  calls = 0; sink.length = 0; if (way === 1) { g36.level = 0; } turn = way === 2 ? () => { g36.level = 0; } : () => {};
  let r: string; try { r = run36(list, list.length); } catch (e: any) { r = "threw " + e.message; }
  g36.level = 2;  turn = () => {};
  console.log("36 " + name + " " + way + " " + r + " calls " + calls + " sink " + sink.slice(-3).map(show).join() + " out " + out.splice(0).join(";"));
}
const g37 = { level: any.call > 9 ? 0 : 2, name: "a" }; const d37b: Record<string, any> = {};
function tell37(...a: any[]): number { calls++; sink.push(a[a.length - 1]); if (sink.length > 20) sink.length = 0; if (calls % 7 === 3) {  } return calls; }
const on37: Record<string, any[]> = { x: [(v: any) => tell37(v)] };
function emit37(name: string, x: any) { const hs = on37[name]; if (!hs) return 0; for (const h of hs) h(x); return 1; }
function note37(x: number): number { if (!(g37.level < 1)) return 0; tell37(x); return 1; }
function run37(list: number[], n: number) { let s = 0, t = 0, best = -1; const keep: number[] = [], o = { last: 0 }, count = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 3; r++) { for (let i = n - 1; i >= 0; i--) { const x = list[i]!; keep.push(x); note37(x); if (d37b["x"]) tell37(x + 1); } } return [s, t, best, keep.length, o.last, count.join("")].map(show).join(" "); }
for (const [name, list] of lists) for (const way of [0, 1, 2]) {
  g37.level = 2; delete d37b["x"]; calls = 0; sink.length = 0; if (way === 1) { g37.level = 0; } turn = way === 2 ? () => { g37.level = 0; } : () => {};
  let r: string; try { r = run37(list, list.length); } catch (e: any) { r = "threw " + e.message; }
  g37.level = 2; delete d37b["x"]; turn = () => {};
  console.log("37 " + name + " " + way + " " + r + " calls " + calls + " sink " + sink.slice(-3).map(show).join() + " out " + out.splice(0).join(";"));
}
const s38 = new Set<any>(); 
function tell38(...a: any[]): number { calls++; sink.push(a[a.length - 1]); if (sink.length > 20) sink.length = 0; if (calls % 7 === 3) {  } return calls; }
const on38: Record<string, any[]> = { x: [(v: any) => tell38(v)] };
function emit38(name: string, x: any) { const hs = on38[name]; if (!hs) return 0; for (const h of hs) h(x); return 1; }
function note38(x: number): number { if (!(s38.size)) return 0; tell38(x); return 1; }
function run38(list: number[], n: number) { let s = 0, t = 0, best = -1; const keep: number[] = [], o = { last: 0 }, count = [0, 0, 0, 0, 0, 0, 0, 0]; for (let i = 0; i < n; i++) { const x = list[i]!; note38(x); if (x > best) best = x; } return [s, t, best, keep.length, o.last, count.join("")].map(show).join(" "); }
for (const [name, list] of lists) for (const way of [0, 1, 2]) {
  s38.clear();  calls = 0; sink.length = 0; if (way === 1) { s38.add(1); } turn = way === 2 ? () => { s38.add(1); } : () => {};
  let r: string; try { r = run38(list, list.length); } catch (e: any) { r = "threw " + e.message; }
  s38.clear();  turn = () => {};
  console.log("38 " + name + " " + way + " " + r + " calls " + calls + " sink " + sink.slice(-3).map(show).join() + " out " + out.splice(0).join(";"));
}
const a39: any[] = []; 
function tell39(...a: any[]): number { calls++; sink.push(a[a.length - 1]); if (sink.length > 20) sink.length = 0; if (calls % 7 === 3) { a39.push(1); } return calls; }
const on39: Record<string, any[]> = { x: [(v: any) => tell39(v)] };
function emit39(name: string, x: any) { const hs = on39[name]; if (!hs) return 0; for (const h of hs) h(x); return 1; }
function note39(x: number): number { if (a39.length > 0) tell39(x); return 0; }
function run39(list: number[], n: number) { let s = 0, t = 0, best = -1; const keep: number[] = [], o = { last: 0 }, count = [0, 0, 0, 0, 0, 0, 0, 0]; for (let i = 0; i < n; i++) { const x = list[i]!; count[x & 7] = (count[x & 7]! + 1) | 0; if (x === 77) break; s = (s + note39(x)) | 0; } return [s, t, best, keep.length, o.last, count.join("")].map(show).join(" "); }
for (const [name, list] of lists) for (const way of [0, 1, 2]) {
  a39.length = 0;  calls = 0; sink.length = 0; if (way === 1) { a39.push(1); } turn = way === 2 ? () => { a39.push(1); } : () => {};
  let r: string; try { r = run39(list, list.length); } catch (e: any) { r = "threw " + e.message; }
  a39.length = 0;  turn = () => {};
  console.log("39 " + name + " " + way + " " + r + " calls " + calls + " sink " + sink.slice(-3).map(show).join() + " out " + out.splice(0).join(";"));
}
const g40 = { on: any.call > 9, level: 2 }; 
function tell40(...a: any[]): number { calls++; sink.push(a[a.length - 1]); if (sink.length > 20) sink.length = 0; if (calls % 7 === 3) { doubles[2] = 2; } return calls; }
const on40: Record<string, any[]> = { x: [(v: any) => tell40(v)] };
function emit40(name: string, x: any) { const hs = on40[name]; if (!hs) return 0; for (const h of hs) h(x); return 1; }
function note40(x: number): number { return g40.on ? tell40(x) & 3 : 5; }
function run40(list: number[], n: number) { let s = 0, t = 0, best = -1; const keep: number[] = [], o = { last: 0 }, count = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 3; r++) { let i = 0; while (i < n) { const x = list[i++]!; if (g40.on) emit40("x", x); if (x > best) best = x; } } return [s, t, best, keep.length, o.last, count.join("")].map(show).join(" "); }
for (const [name, list] of lists) for (const way of [0, 1, 2]) {
  g40.on = false;  calls = 0; sink.length = 0; if (way === 1) { g40.on = true; } turn = way === 2 ? () => { g40.on = true; } : () => {};
  let r: string; try { r = run40(list, list.length); } catch (e: any) { r = "threw " + e.message; }
  g40.on = false;  turn = () => {};
  console.log("40 " + name + " " + way + " " + r + " calls " + calls + " sink " + sink.slice(-3).map(show).join() + " out " + out.splice(0).join(";"));
}
let f41: { k: number } | null = any.call > 9 ? { k: 1 } : null; let f41b: string = any.call > 9 ? "loud" : "quiet";
function tell41(...a: any[]): number { calls++; sink.push(a[a.length - 1]); if (sink.length > 20) sink.length = 0; if (calls % 7 === 3) { if (calls % 5 === 4) throw new Error("e" + calls); } return calls; }
const on41: Record<string, any[]> = { x: [(v: any) => tell41(v)] };
function emit41(name: string, x: any) { const hs = on41[name]; if (!hs) return 0; for (const h of hs) h(x); return 1; }
function note41(x: number): number { return f41 !== null ? tell41(x) & 3 : 5; }
function run41(list: number[], n: number) { let s = 0, t = 0, best = -1; const keep: number[] = [], o = { last: 0 }, count = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 3; r++) { let i = 0; while (i < n) { const x = list[i++]!; s = (s + note41(x)) | 0; if (f41b === "loud") tell41(x + 1); s = (s ^ x) + 1 | 0; } } return [s, t, best, keep.length, o.last, count.join("")].map(show).join(" "); }
for (const [name, list] of lists) for (const way of [0, 1, 2]) {
  f41 = null; f41b = "quiet"; calls = 0; sink.length = 0; if (way === 1) { f41 = { k: 1 }; } turn = way === 2 ? () => { f41 = { k: 1 }; } : () => {};
  let r: string; try { r = run41(list, list.length); } catch (e: any) { r = "threw " + e.message; }
  f41 = null; f41b = "quiet"; turn = () => {};
  console.log("41 " + name + " " + way + " " + r + " calls " + calls + " sink " + sink.slice(-3).map(show).join() + " out " + out.splice(0).join(";"));
}
function make42() { let on = any.call > 9; return { is: () => on, set: (v: boolean) => { on = v; } }; } const c42 = make42(); 
function tell42(...a: any[]): number { calls++; sink.push(a[a.length - 1]); if (sink.length > 20) sink.length = 0; if (calls % 7 === 3) { if (calls % 5 === 4) throw new Error("e" + calls); } return calls; }
const on42: Record<string, any[]> = { x: [(v: any) => tell42(v)] };
function emit42(name: string, x: any) { const hs = on42[name]; if (!hs) return 0; for (const h of hs) h(x); return 1; }
function note42(x: number): number { return c42.is() ? tell42(x) & 3 : 5; }
function run42(list: number[], n: number) { let s = 0, t = 0, best = -1; const keep: number[] = [], o = { last: 0 }, count = [0, 0, 0, 0, 0, 0, 0, 0]; for (let i = 0; i < n; i++) { const x = list[i]!; keep.push(x); note42(x); } return [s, t, best, keep.length, o.last, count.join("")].map(show).join(" "); }
for (const [name, list] of lists) for (const way of [0, 1, 2]) {
  c42.set(false);  calls = 0; sink.length = 0; if (way === 1) { c42.set(true); } turn = way === 2 ? () => { c42.set(true); } : () => {};
  let r: string; try { r = run42(list, list.length); } catch (e: any) { r = "threw " + e.message; }
  c42.set(false);  turn = () => {};
  console.log("42 " + name + " " + way + " " + r + " calls " + calls + " sink " + sink.slice(-3).map(show).join() + " out " + out.splice(0).join(";"));
}
(globalThis as any).G43 = false; (globalThis as any).G43b = false;
function tell43(...a: any[]): number { calls++; sink.push(a[a.length - 1]); if (sink.length > 20) sink.length = 0; if (calls % 7 === 3) { few.push(1); if (few.length > 8) few.length = 3; } return calls; }
const on43: Record<string, any[]> = { x: [(v: any) => tell43(v)] };
function emit43(name: string, x: any) { const hs = on43[name]; if (!hs) return 0; for (const h of hs) h(x); return 1; }
function note43(x: number): number { if (!((globalThis as any).G43)) return 0; tell43(x); return 1; }
function run43(list: number[], n: number) { let s = 0, t = 0, best = -1; const keep: number[] = [], o = { last: 0 }, count = [0, 0, 0, 0, 0, 0, 0, 0]; let i = 0; for (const x of list) { o.last = x; if ((globalThis as any).G43) tell43(x); if ((globalThis as any).G43b) tell43(x + 1); i++; } return [s, t, best, keep.length, o.last, count.join("")].map(show).join(" "); }
for (const [name, list] of lists) for (const way of [0, 1, 2]) {
  (globalThis as any).G43 = false; (globalThis as any).G43b = false; calls = 0; sink.length = 0; if (way === 1) { (globalThis as any).G43 = true; } turn = way === 2 ? () => { (globalThis as any).G43 = true; } : () => {};
  let r: string; try { r = run43(list, list.length); } catch (e: any) { r = "threw " + e.message; }
  (globalThis as any).G43 = false; (globalThis as any).G43b = false; turn = () => {};
  console.log("43 " + name + " " + way + " " + r + " calls " + calls + " sink " + sink.slice(-3).map(show).join() + " out " + out.splice(0).join(";"));
}
let f44: { k: number } | null = any.call > 9 ? { k: 1 } : null; 
function tell44(...a: any[]): number { calls++; sink.push(a[a.length - 1]); if (sink.length > 20) sink.length = 0; if (calls % 7 === 3) { few.push(1); if (few.length > 8) few.length = 3; } return calls; }
const on44: Record<string, any[]> = { x: [(v: any) => tell44(v)] };
function emit44(name: string, x: any) { const hs = on44[name]; if (!hs) return 0; for (const h of hs) h(x); return 1; }
function note44(x: number): number { return f44 !== null ? tell44(x) & 3 : 5; }
function run44(list: number[], n: number) { let s = 0, t = 0, best = -1; const keep: number[] = [], o = { last: 0 }, count = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 3; r++) { for (let i = 0; i < n; i += 2) { const x = list[i]!; o.last = x; if (x > 90) t++; note44(x); } } return [s, t, best, keep.length, o.last, count.join("")].map(show).join(" "); }
for (const [name, list] of lists) for (const way of [0, 1, 2]) {
  f44 = null;  calls = 0; sink.length = 0; if (way === 1) { f44 = { k: 1 }; } turn = way === 2 ? () => { f44 = { k: 1 }; } : () => {};
  let r: string; try { r = run44(list, list.length); } catch (e: any) { r = "threw " + e.message; }
  f44 = null;  turn = () => {};
  console.log("44 " + name + " " + way + " " + r + " calls " + calls + " sink " + sink.slice(-3).map(show).join() + " out " + out.splice(0).join(";"));
}
(globalThis as any).G45 = false; 
function tell45(...a: any[]): number { calls++; sink.push(a[a.length - 1]); if (sink.length > 20) sink.length = 0; if (calls % 7 === 3) { (globalThis as any).G45 = true; } return calls; }
const on45: Record<string, any[]> = { x: [(v: any) => tell45(v)] };
function emit45(name: string, x: any) { const hs = on45[name]; if (!hs) return 0; for (const h of hs) h(x); return 1; }
function note45(x: number): number { if ((globalThis as any).G45) tell45(x); return 0; }
function run45(list: number[], n: number) { let s = 0, t = 0, best = -1; const keep: number[] = [], o = { last: 0 }, count = [0, 0, 0, 0, 0, 0, 0, 0]; for (let i = n - 1; i >= 0; i--) { const x = list[i]!; if ((globalThis as any).G45) emit45("x", x); count[x & 7] = (count[x & 7]! + 1) | 0; } return [s, t, best, keep.length, o.last, count.join("")].map(show).join(" "); }
for (const [name, list] of lists) for (const way of [0, 1, 2]) {
  (globalThis as any).G45 = false;  calls = 0; sink.length = 0; if (way === 1) { (globalThis as any).G45 = true; } turn = way === 2 ? () => { (globalThis as any).G45 = true; } : () => {};
  let r: string; try { r = run45(list, list.length); } catch (e: any) { r = "threw " + e.message; }
  (globalThis as any).G45 = false;  turn = () => {};
  console.log("45 " + name + " " + way + " " + r + " calls " + calls + " sink " + sink.slice(-3).map(show).join() + " out " + out.splice(0).join(";"));
}
let f46: number = any.call > 9 ? 3 : 0; 
function tell46(...a: any[]): number { calls++; sink.push(a[a.length - 1]); if (sink.length > 20) sink.length = 0; if (calls % 7 === 3) { ints[3] = 1.5; ints[3] = 7; } return calls; }
const on46: Record<string, any[]> = { x: [(v: any) => tell46(v)] };
function emit46(name: string, x: any) { const hs = on46[name]; if (!hs) return 0; for (const h of hs) h(x); return 1; }
function note46(x: number): number { return f46 > 1 ? tell46(x) & 3 : 5; }
function run46(list: number[], n: number) { let s = 0, t = 0, best = -1; const keep: number[] = [], o = { last: 0 }, count = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 3; r++) { let i = 0; while (i < n) { const x = list[i++]!; s += x; note46(x); } } return [s, t, best, keep.length, o.last, count.join("")].map(show).join(" "); }
for (const [name, list] of lists) for (const way of [0, 1, 2]) {
  f46 = 0;  calls = 0; sink.length = 0; if (way === 1) { f46 = 3; } turn = way === 2 ? () => { f46 = 3; } : () => {};
  let r: string; try { r = run46(list, list.length); } catch (e: any) { r = "threw " + e.message; }
  f46 = 0;  turn = () => {};
  console.log("46 " + name + " " + way + " " + r + " calls " + calls + " sink " + sink.slice(-3).map(show).join() + " out " + out.splice(0).join(";"));
}
let f47: { k: number } | null = any.call > 9 ? { k: 1 } : null; 
function tell47(...a: any[]): number { calls++; sink.push(a[a.length - 1]); if (sink.length > 20) sink.length = 0; if (calls % 7 === 3) { f47 = null; } return calls; }
const on47: Record<string, any[]> = { x: [(v: any) => tell47(v)] };
function emit47(name: string, x: any) { const hs = on47[name]; if (!hs) return 0; for (const h of hs) h(x); return 1; }
function note47(x: number): number { if (!(f47 !== null)) return 0; tell47(x); return 1; }
function run47(list: number[], n: number) { let s = 0, t = 0, best = -1; const keep: number[] = [], o = { last: 0 }, count = [0, 0, 0, 0, 0, 0, 0, 0]; try { for (let r = 0; r < 3; r++) { let i = 0; for (const x of list) { if (f47 !== null) { s = (s + emit47("x", x)) | 0; } keep.push(x); i++; } } } catch (e: any) { s += 100; out.push("caught " + (e && e.message)); } finally { t += 1; } return [s, t, best, keep.length, o.last, count.join("")].map(show).join(" "); }
for (const [name, list] of lists) for (const way of [0, 1, 2]) {
  f47 = null;  calls = 0; sink.length = 0; if (way === 1) { f47 = { k: 1 }; } turn = way === 2 ? () => { f47 = { k: 1 }; } : () => {};
  let r: string; try { r = run47(list, list.length); } catch (e: any) { r = "threw " + e.message; }
  f47 = null;  turn = () => {};
  console.log("47 " + name + " " + way + " " + r + " calls " + calls + " sink " + sink.slice(-3).map(show).join() + " out " + out.splice(0).join(";"));
}
