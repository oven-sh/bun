// STATISTIC: CopiesWalkedWhereTheirGuardsFail <= 1
declare const process: { readonly argv: readonly string[] };
export {};
interface Reading { low: number; mid: number; high: number }
const readings = JSON.parse("[" + Array.from({ length: 24 }, (_, i) => `{"low":${i * 0.5},"mid":${i * 0.5 + 1},"high":${i * 0.5 + 2}}`).join() + "]") as unknown as Reading[];
class Span { low = 0; mid = 0; high = 0; take(reading: Reading): void { this.low = reading.low; this.mid = reading.mid; this.high = reading.high; } constructor(reading: Reading) { this.take(reading); } }
const make = (reading: Reading): Span => new Span(reading);
function width(t: number): number { let s = t & 1; for (let i = 0; i < 24; i++) { const span = make(readings[i]!); s += span.high - span.low; } return s; }
const n = +(process.argv[2] ?? 3); let sum = 0; for (let t = 0; t < n; t++) sum = (sum + width(t)) % 1000003; console.log(Math.floor(sum));
