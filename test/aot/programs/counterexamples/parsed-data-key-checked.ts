// Parsed JSON that is a key of a Map and a member of a WeakSet is held to a type and still found.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
function parse(t: string): any { return JSON.parse(t) }
interface Sub { v: number }
interface Big { a: number; b: number; c: number; d: number; e: number; f: number; g: number; h: number; sub: Sub | null }
const madeBig: Big = { a: 0.5, b: 1.5, c: 2.5, d: 3.5, e: 4.5, f: 5.5, g: 6.5, h: 7.5, sub: { v: 1 } };
function first(x: Big): number { x.a += 1; return x.a }
row("(made by typed code)", () => first(madeBig));
const bigText = '{"a":0.5,"b":1.5,"c":2.5,"d":3.5,"e":4.5,"f":5.5,"g":6.5,"h":7.5,"sub":null}';
row("large data as a key, then held to a type", () => { const raw = parse(bigText); const m = new Map<unknown, number>([[raw, 1]]); const w = new WeakSet<object>([raw]); const t: Big = raw; return m.get(t) + " " + w.has(t) });
