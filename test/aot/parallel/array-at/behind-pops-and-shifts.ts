// at() behind pop, shift, push and stores past the length, with ?? and in company of other reads.
function behindPop(a: number[]): number { let n = 0; for (let i = 0; i < 6; i++) { a.pop(); n += a.at(-1) ?? 7; } return n; }
function behindShift(a: number[]): number { let n = 0; for (let i = 0; i < 6; i++) { n += a.at(-1) ?? 7; a.shift(); n += a.at(0) ?? 0.5; } return n; }
function both(a: number[]): number { let n = 0; for (let i = 0; i < 6; i++) { n += (a.at(-1) ?? 7) + (a.at(-2) ?? 3); if (i & 1) a.pop(); else a.shift(); } return n; }
function pushed(a: number[]): number { let n = 0; for (let i = 0; i < 6; i++) { a.push(i + 0.5); n += a.at(-1)! - a.at(i)!; } return n; }
function past(a: boolean[]): string { let s = ""; let old = 0; for (let i = 0; i < 6; i++) { s += String(a.at(old)); a[a.length + 1] = i > 2; old = a.length - 2; } return s; }
function texts(a: string[]): string { let s = ""; for (let i = 0; i < 6; i++) { s += a.at(-1) ?? "none"; a.length = Math.max(0, a.length - 1); s += a.at(i) ?? "-"; } return s; }
function own(): number { const a = [1, 2, 3]; let n = 0; for (let i = 0; i < 6; i++) { n += a.at(-1) ?? 7; a.pop(); n = n * 2 + (a.at(0) ?? 1); } return n; }
function ownDoubles(): number { const a = [1.5, 2.5]; let n = 0; for (let i = 0; i < 6; i++) { n += a.at(i) ?? 7; a[a.length] = i; n += a.at(-1)!; if (i === 3) a.length = 0; } return n; }
function ownFlags(): string { const a = [true, false]; let s = ""; for (let i = 0; i < 5; i++) { s += a.at(i) ? "y" : "n"; a[i + 3] = i > 1; s += typeof a.at(-2); } return s; }
function objects(): number { const a = [{ v: 1 }, { v: 2 }]; let n = 0; for (let i = 0; i < 5; i++) { const p = a.at(-1); n += p ? p.v : 100; if (i > 1) a.pop(); } return n; }
const out: string[] = [];
function tell(name: string, f: () => unknown): void { let r: string; try { r = String(f()); } catch (e: any) { r = e.constructor.name; } out.push(name + " " + r); }
for (const make of [() => [1, 2, 3, 4], () => [1.5, 2, 3.5], () => [], () => [5], () => JSON.parse("[1,2.5,3]")]) for (const run of [behindPop, behindShift, both, pushed]) tell(run.name, () => run(make()));
tell("past", () => past([true, false])); tell("past none", () => past([])); tell("texts", () => texts(["a", "b", "c"])); tell("texts none", () => texts([]));
for (const run of [own, ownDoubles, ownFlags, objects]) tell(run.name, run);
console.log(out.join("\n"));
export {};
