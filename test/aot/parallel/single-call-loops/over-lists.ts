// Small functions with a loop over a list from in front of the caller's loop, called at one place: they are copied there.
let log = "";
function show(...values: any[]): void { for (const v of values) log += (Object.is(v, -0) ? "-0" : typeof v === "object" && v ? JSON.stringify(v) : String(v)) + ","; log += ";"; }
const parse = (text: string): any => JSON.parse(text);
const int32s = (): number[] => parse("[5,17,-3,0,7,19,23,100000,3,4]");
const doubles = (): number[] => parse("[5.5,17,-0.0,0,1e300,7,-2.25,3]");
const holes = (): number[] => { const a = int32s(); delete a[3]; return a; };
const named = (): number[] => { const a: any = int32s(); a[-1] = 99; a["1.5"] = 98.5; return a; };
const mixed = (): number[] => [1, "two", 3.5, null, undefined, 4] as any;
const empty = (): number[] => [];
const short = (): number[] => [7];
const texts = (): number[] => ["b", "a", "", "cc"] as any;
const viewed = (): number[] => new Float64Array([1.5, 2, -0, 4]) as any;
const none = (): number[] => null as any;
const makers = [int32s, doubles, holes, named, mixed, empty, short, texts, viewed, none];
const starts = [0, 1, 2, 6, 9, 10, -1, -2, 0.5, -0, NaN, 4294967295, 9007199254740991, "1" as any, undefined as any];
function sum(values: number[], from: number): number { let total = 0; for (let i = from; i < from + 4 && i < values.length; i++) total += values[i]; return total; }
function sums(values: number[]): string { let text = ""; for (const from of starts) text += sum(values, from) + "|"; return text; }
function bounds(values: number[], from: number): { low: number; high: number } { let low = values[from], high = values[from]; for (let i = from + 1; i < from + 4 && i < values.length; i++) { if (values[i] < low) low = values[i]; if (values[i] > high) high = values[i]; } return { low, high }; }
function allBounds(values: number[]): string { let text = ""; for (let k = 0; k < values.length + 2; k++) { const { low, high } = bounds(values, k); text += low + ":" + high + "|"; } return text; }
function pair(values: number[], from: number): [number, number] { let a = 0, b = 1; for (let i = from; i < from + 3; i++) { a += values[i]; b *= values[i] || 1; } return [a, b]; }
function pairs(values: number[]): string { let text = ""; for (let k = -1; k < values.length; k++) { const [a, b] = pair(values, k); text += a + ":" + b + "|"; } return text; }
function find(values: number[], wanted: any): number { for (let i = 0; i < values.length; i++) if (values[i] === wanted) return i; return -1; }
function finds(values: number[], wanted: any[]): string { let text = ""; for (const w of wanted) text += find(values, w) + "|"; return text; }
function fill(values: number[], from: number, value: any): number { let stored = 0; for (let i = from; i < from + 2; i++) { if (values[i] !== value) { values[i] = value; stored++; } } return stored; }
function fills(values: number[], value: any): string { let text = ""; for (let k = 0; k < 5; k++) text += fill(values, k, k === 3 ? value : k) + "|"; return text + (values && values.length); }
function down(values: number[], from: number): number { let last = -1; for (let i = from; i >= 0; i--) { if (values[i] > 4) { last = i; break; } } return last; }
function downs(values: number[]): string { let text = ""; for (let k = 0; k < 12; k++) text += down(values, k) + "|"; return text; }
function row(values: number[], by: number): number { let total = 0; for (const v of values) total = total * 2 + v * by; return total; }
function rows(values: number[]): string { let text = ""; for (let k = 0; k < 3; k++) text += row(values, k) + "|"; return text; }
function nested(values: number[], i: number): number { let more = 0; for (let k = i + 1; k < values.length; k++) if (values[k] > values[i]) more++; return more; }
function inversions(values: number[]): number { let total = 0; for (let i = 0; i < values.length; i++) total += nested(values, i); return total; }
function longer(values: number[], from: number): number { let i = from; while (i < values.length && values[i] >= values[from]) i++; return i; }
function runs(values: number[]): string { let text = "", at = 0, turns = 0; while (at < values.length && turns++ < 20) { const end = longer(values, at); text += end + "|"; at = end > at ? end : at + 1; } return text; }
function inTry(values: number[], from: number): number { let total = 0; for (let i = from; i < from + 2; i++) total += (values[i] as any).toFixed ? 1 : 0; return total; }
function tries(values: number[]): string { let text = ""; for (let k = 0; k < 6; k++) { try { text += inTry(values, k) + "|"; } catch (error: any) { text += error.constructor.name + "|"; } } return text; }
function shrinking(values: number[], at: number): string { let text = ""; for (let i = at; i < at + 3; i++) { text += values[i] + " "; if (i === at + 1) values.length = 2; } return text; }
function shrinks(values: number[]): string { let text = ""; for (let k = 0; k < 4; k++) text += shrinking(values, k) + "|"; return text; }
function replaced(values: number[], from: number): number { let total = 0; for (let i = from; i < values.length; i++) total += values[i]; return total; }
function replaces(values: number[]): string { let text = ""; let list = values; for (let k = 0; k < 4; k++) { text += replaced(list, k) + "|"; if (k === 1) list = doubles(); if (k === 2) list = mixed(); } return text; }
class Table { constructor(public cells: number[]) {} at(values: number[], from: number): number { let total = 0; for (let i = from; i < from + 3 && i < values.length; i++) total += values[i]; return total; } all(): string { let text = ""; const { cells } = this; for (let k = 0; k < 5; k++) text += this.at(cells, k) + "|"; return text; } }
const attempt = (f: () => any): any => { try { return f(); } catch (error: any) { return error.constructor.name; } };
for (let round = 0; round < 3; round++) {
  for (const make of makers) {
    show(attempt(() => sums(make())), attempt(() => allBounds(make())), attempt(() => pairs(make())), attempt(() => finds(make(), [5, 5.5, 0, -0, "two", null, undefined, NaN, 4])), attempt(() => fills(make(), "x")), attempt(() => fills(make(), 2.5)), attempt(() => downs(make())), attempt(() => rows(make())));
    show(attempt(() => inversions(make())), attempt(() => runs(make())), attempt(() => tries(make())), attempt(() => shrinks(make())), attempt(() => replaces(make())), attempt(() => new Table(make()).all()));
  }
}
let state = 7, check = 0;
for (let i = 0; i < 300; i++) { const list: number[] = []; for (let k = 0; k < 20; k++) { state = (state * 16807) % 2147483647; list.push(state % 5 ? state % 100 : state / 7); } check = (check * 31 + inversions(list) + Number(runs(list).length)) % 1000003; }
show(check);
console.log(log.length, log);
