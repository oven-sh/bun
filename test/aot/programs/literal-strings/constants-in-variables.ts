// A literal that a variable of a union of string literals holds is printed, stored or passed on at once, and the variable goes on to a join.
type K = "a" | "b" | "c";
const seen: string[] = [];
function log(s: string) { seen.push(s); }
class P { k: K = "a"; s: string = "s"; }
function printedThenJoined(c: boolean): K { let k: K = "a"; log(k); if (c) k = "b"; return k; }
function pushedThenLooped(n: number): K { let k: K = "a"; seen.push(k); while (n-- > 0) k = k === "a" ? "b" : "c"; return k; }
function stringThenNumber(c: boolean): string { let s: string = "a"; const k: K = c ? "b" : "a"; if (c) s = k; return s; }
function storedThenPrinted(c: boolean): K { const o = new P(); let k: K = "c"; o.k = k; log(k); if (c) k = o.k; return k; }
function bothKinds(c: boolean): string { const o = new P(); let k: K = "b"; o.s = k; o.k = k; if (c) k = "c"; return o.s + o.k + k; }
function templated(c: boolean): string { let k: K = "a"; const t = `${k}!`; if (c) k = "c"; return t + k; }
function keyed(c: boolean): number { const counts: Record<string, number> = { a: 1, b: 2 }; let k: K = "a"; const n = counts[k]; if (c) k = "b"; return n + counts[k]; }
function compared(c: boolean): string { let k: K = "a"; const was = k === "a"; log(k); if (c) k = "b"; return String(was) + (k === "a") + k; }
function returnedOrPrinted(n: number): K { let k: K = "a"; if (n === 0) return k; log(k); if (n === 1) k = "b"; else if (n === 2) k = "c"; return k; }
const out: unknown[] = [];
for (const c of [true, false]) out.push(printedThenJoined(c), stringThenNumber(c), storedThenPrinted(c), bothKinds(c), templated(c), keyed(c), compared(c));
for (let n = 0; n < 4; n++) out.push(pushedThenLooped(n), returnedOrPrinted(n));
console.log(out.join(" "), seen.join(""));
