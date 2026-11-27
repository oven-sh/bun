// STATISTIC: StoredSlotsTestedBeforeLoops >= 2
// @ts-nocheck
// Exported variables of namespaces and fields that another function fills, counted by functions that loops call: before they are filled, filled in the loop, deleted between and during loops, with a value of
// a prototype behind them, with an accessor, frozen, with text in the place of a number.
const show = x => Object.is(x, -0) ? "-0" : String(x);
const out: string[] = [];
namespace Stats { export let hits = 0; export let sum = 0.5; export function hit(x: number): void { hits++; sum += x; } }
function runStats(turns: number) { for (let k = 0; k < turns; k++) Stats.hit(k & 7); }
for (const turns of [0, 1, 8, 100]) { runStats(turns); out.push(Stats.hits + " " + show(Stats.sum)); }
const late: any = { first: 1 };
function count(x) { late.n += x; late.calls++; }
function runLate(turns, stop) { for (let k = 0; k < turns; k++) { count(k); if (k === stop) break; } }
function fill() { late.n = -0; late.calls = 0; }
runLate(0, -1); out.push(Object.keys(late).join("+"));
runLate(3, -1); out.push(show(late.n) + " " + show(late.calls) + " " + Object.keys(late).join("+"));
fill(); runLate(9, -1); out.push(show(late.n) + " " + late.calls); runLate(9, 4); out.push(show(late.n) + " " + late.calls);
delete late.n; runLate(4, -1); out.push(show(late.n) + " " + late.calls + " " + Object.keys(late).join("+"));
const other = late;
function runDeleting(turns, stop) { for (let k = 0; k < turns; k++) { count(1); if (k === stop) delete other.calls; } }
fill(); runDeleting(6, 3); out.push(show(late.n) + " " + show(late.calls) + " " + Object.keys(late).join("+"));
class Meter { reset() { this.total = 0; this.largest = -1; } add(x) { this.total += x; if (x > this.largest) this.largest = x; } }
const meter = new Meter();
function runMeter(turns) { for (let k = 0; k < turns; k++) meter.add(k & 3); }
runMeter(2); out.push(show(meter.total) + " " + show(meter.largest));
meter.reset(); for (const turns of [0, 1, 7, 64]) { runMeter(turns); out.push(meter.total + " " + meter.largest); }
Object.setPrototypeOf(other, { n: 100 }); delete late.n; runLate(3, -1); out.push(show(late.n) + " " + late.calls); Object.setPrototypeOf(other, Object.prototype);
fill(); late.n = "t"; runLate(3, -1); out.push(late.n + " " + late.calls);
Object.defineProperty(late, "calls", { get() { return 4; }, set(v) { out.push("set " + v); }, configurable: true, enumerable: true });
late.n = 0; runLate(3, -1); out.push(show(late.n) + " " + late.calls);
Object.freeze(Stats); try { runStats(3); out.push("ran"); } catch (e) { out.push(e.name); }
out.push(Stats.hits + " " + show(Stats.sum));
console.log(out.join());
