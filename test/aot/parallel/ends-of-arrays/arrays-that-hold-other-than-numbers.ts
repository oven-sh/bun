// push, pop, shift, unshift and at of arrays that are declared to hold numbers and hold other values too, at every length at which shift() goes another way.
function show(v: any): string { return typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? "{" + Object.keys(v).join() + "}" : typeof v === "symbol" ? "symbol" : String(v); }
function row(a: any): string { let s = a.length + ":"; let h = 0; for (let i = 0; i < a.length; i++) { const t = i in a ? show(a[i]) : "hole"; if (i < 3 || i > a.length - 4) s += t + ","; for (let k = 0; k < t.length; k++) h = (h * 31 + t.charCodeAt(k)) | 0; } return s + h; }
function attempt(f: () => any): string { try { return show(f()); } catch (e: any) { return "throws " + e.name; } }
const out: string[] = [];
function note(...parts: any[]): void { out.push(parts.map(p => typeof p === "string" ? p : show(p)).join(" ")); }
function once_shift(a: number[], x: any, k: number): any { return a.shift(); }
function loop_shift(a: number[], x: any, k: number, count: number): any { let t: any = 0; for (let i = 0; i < count; i++) { const r: any = a.shift(); if (typeof r === "number") t += r; else if (i < 4) t = t + ":" + show(r); } return t; }
function once_pop(a: number[], x: any, k: number): any { return a.pop(); }
function loop_pop(a: number[], x: any, k: number, count: number): any { let t: any = 0; for (let i = 0; i < count; i++) { const r: any = a.pop(); if (typeof r === "number") t += r; else if (i < 4) t = t + ":" + show(r); } return t; }
function once_push(a: number[], x: any, k: number): any { return a.push(x as number); }
function loop_push(a: number[], x: any, k: number, count: number): any { let t: any = 0; for (let i = 0; i < count; i++) { const r: any = a.push(x as number); if (typeof r === "number") t += r; else if (i < 4) t = t + ":" + show(r); } return t; }
function once_unshift(a: number[], x: any, k: number): any { return a.unshift(x as number); }
function loop_unshift(a: number[], x: any, k: number, count: number): any { let t: any = 0; for (let i = 0; i < count; i++) { const r: any = a.unshift(x as number); if (typeof r === "number") t += r; else if (i < 4) t = t + ":" + show(r); } return t; }
function once_at(a: number[], x: any, k: number): any { return a.at(k) as any; }
function loop_at(a: number[], x: any, k: number, count: number): any { let t: any = 0; for (let i = 0; i < count; i++) { const r: any = a.at(k) as any; if (typeof r === "number") t += r; else if (i < 4) t = t + ":" + show(r); } return t; }
function once_at_last(a: number[], x: any, k: number): any { return a.at(-1) as any; }
function loop_at_last(a: number[], x: any, k: number, count: number): any { let t: any = 0; for (let i = 0; i < count; i++) { const r: any = a.at(-1) as any; if (typeof r === "number") t += r; else if (i < 4) t = t + ":" + show(r); } return t; }
function once_shift_and(a: number[], x: any, k: number): any { return (a.shift()! & 255); }
function loop_shift_and(a: number[], x: any, k: number, count: number): any { let t: any = 0; for (let i = 0; i < count; i++) { const r: any = (a.shift()! & 255); if (typeof r === "number") t += r; else if (i < 4) t = t + ":" + show(r); } return t; }
function once_pop_and(a: number[], x: any, k: number): any { return (a.pop()! + 1); }
function loop_pop_and(a: number[], x: any, k: number, count: number): any { let t: any = 0; for (let i = 0; i < count; i++) { const r: any = (a.pop()! + 1); if (typeof r === "number") t += r; else if (i < 4) t = t + ":" + show(r); } return t; }
function make(n: number): number[] { const a: number[] = []; for (let i = 0; i < n; i++) (a as any[]).push(i % 7 === 3 ? "t" + i : i % 7 === 5 ? { v: i } : i); return a; }
for (const n of [0, 1, 2, 3, 8, 16, 17, 18, 31, 32, 33, 34, 64, 65, 127, 128, 129, 130, 300]) {
  { const a = make(n); note("shift", n, attempt(() => once_shift(a, 5, 1)), row(a), attempt(() => once_shift(a, 0.5, 0)), row(a)); const b = make(n); note(attempt(() => loop_shift(b, 3, 2, 5)), row(b), attempt(() => loop_shift(b, "q", 2, n + 2)), row(b)); }
  { const a = make(n); note("pop", n, attempt(() => once_pop(a, 5, 1)), row(a), attempt(() => once_pop(a, 0.5, 0)), row(a)); const b = make(n); note(attempt(() => loop_pop(b, 3, 2, 5)), row(b), attempt(() => loop_pop(b, "q", 2, n + 2)), row(b)); }
  { const a = make(n); note("push", n, attempt(() => once_push(a, 5, 1)), row(a), attempt(() => once_push(a, 0.5, 0)), row(a)); const b = make(n); note(attempt(() => loop_push(b, 3, 2, 5)), row(b), attempt(() => loop_push(b, "q", 2, n + 2)), row(b)); }
  { const a = make(n); note("unshift", n, attempt(() => once_unshift(a, 5, 1)), row(a), attempt(() => once_unshift(a, 0.5, 0)), row(a)); const b = make(n); note(attempt(() => loop_unshift(b, 3, 2, 5)), row(b), attempt(() => loop_unshift(b, "q", 2, n + 2)), row(b)); }
  { const a = make(n); note("at", n, attempt(() => once_at(a, 5, 1)), row(a), attempt(() => once_at(a, 0.5, 0)), row(a)); const b = make(n); note(attempt(() => loop_at(b, 3, 2, 5)), row(b), attempt(() => loop_at(b, "q", 2, n + 2)), row(b)); }
  { const a = make(n); note("at-last", n, attempt(() => once_at_last(a, 5, 1)), row(a), attempt(() => once_at_last(a, 0.5, 0)), row(a)); const b = make(n); note(attempt(() => loop_at_last(b, 3, 2, 5)), row(b), attempt(() => loop_at_last(b, "q", 2, n + 2)), row(b)); }
  { const a = make(n); note("shift-and", n, attempt(() => once_shift_and(a, 5, 1)), row(a), attempt(() => once_shift_and(a, 0.5, 0)), row(a)); const b = make(n); note(attempt(() => loop_shift_and(b, 3, 2, 5)), row(b), attempt(() => loop_shift_and(b, "q", 2, n + 2)), row(b)); }
  { const a = make(n); note("pop-and", n, attempt(() => once_pop_and(a, 5, 1)), row(a), attempt(() => once_pop_and(a, 0.5, 0)), row(a)); const b = make(n); note(attempt(() => loop_pop_and(b, 3, 2, 5)), row(b), attempt(() => loop_pop_and(b, "q", 2, n + 2)), row(b)); }
}
for (const x of [1, 2147483647, -2147483648, 2147483648, 0.5, -0, NaN, Infinity, "s", undefined, null, true, { a: 1 }, 7n, 9007199254740992]) for (const n of [0, 3, 20, 40, 140]) { const a = make(n); note(show(x), n, attempt(() => once_push(a, x, 0)), row(a), attempt(() => loop_push(a, x, 0, 3)), row(a), attempt(() => once_unshift(a, x, 0)), row(a), attempt(() => once_shift(a, x, 0)), attempt(() => loop_shift(a, x, 0, 3)), attempt(() => once_pop(a, x, 0)), attempt(() => loop_pop(a, x, 0, 4)), row(a)); }
console.log(out.join("\n"));
