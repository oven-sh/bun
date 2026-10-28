interface Settings { a: number; b: number; c: number; d: number; e: number; f: number; g: number; h: number; }
interface Totals { a: number; b: number; c: number; d: number; e: number; f: number; g: number; }
type Fits<From, To> = From extends To ? "fits" : "differs";
const kept: unknown[] = [];
function keep(data: any): any { kept.push(data); return data; }
function makeTotals(n: number): Totals { return { a: n, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6 }; }
function sum(totals: Totals): number { return totals.a + totals.g; }
const verdict: Fits<Settings, Totals> = "fits";
const settings: Settings = keep(JSON.parse('{"a":1,"b":2,"c":3,"d":4,"e":5,"f":6,"g":70,"h":8}'));
const totals: Totals = settings;
console.log(verdict, sum(totals), sum(makeTotals(1)), totals === kept[0]);
