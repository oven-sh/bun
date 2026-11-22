// remainderBy writeSelf straight method inner on=view n=3 reaches
const out: any[] = [];
let hits = 0;
let peek: any = null;
function show(x: any): string { if (typeof x === "number") return Object.is(x, -0) ? "-0" : "n" + x; if (typeof x === "string") return JSON.stringify(x); if (x === null || x === undefined || typeof x === "function") return typeof x; if (Array.isArray(x)) return "[" + x.map(show).join(" ") + "]"; return x instanceof Error ? x.name : typeof x + JSON.stringify(x); }
function said(e: any): string { return e instanceof Error ? e.name : "!" + show(e); }
function step(): number { hits++; if (peek) out.push(peek()); if (hits === 17) throw undefined; return hits; }
function pair(a: any, b: any): string { return show(a) + "/" + show(b); }
const made: any = new Float64Array([1, 5, 2, 3]);
const mild: Float64Array = new Float64Array([1, 5, 2, 3]);
class Host { run(from: number, divisor: number, store: Float64Array): any {
  const by = divisor | 0;
  for (let round = 0; round < 2; round++) { try { for (let i = from | 0; i < -1; i++) { const slot: any = i % by; peek = () => slot; out.push(pair((store[slot] = slot), slot));  out.push(show(slot), show(i)); } } catch (e: any) { out.push(said(e)); } }
} }
const host = new Host();
try { out.push(host.run(JSON.parse("-4"), JSON.parse("4"), mild)); } catch (e: any) { out.push("escaped", said(e)); }
try { out.push(host.run(JSON.parse("-4"), JSON.parse("4"), made)); } catch (e: any) { out.push("escaped", said(e)); }
out.push(Object.keys(made).join(), Object.values(made));
out.push(Object.keys(mild).join(), Object.values(mild));
console.log(out.map(show).join(" "), hits);
export {};
