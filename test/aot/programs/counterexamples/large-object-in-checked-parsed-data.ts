// Parsed JSON that holds an object of nine members is held to a type, and every object in it stays the same.
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
interface Holder { id: string; big: Big | null; sub: Sub | null }
const madeHolder: Holder = { id: "m", big: madeBig, sub: null };
row("one such below: the whole graph", () => { const raw = parse('{"id":"s","big":null,"sub":{"v":2}}'); raw.big = parse(bigText); const sub = raw.sub; const t: Holder = raw; t.id = "u"; t.sub!.v = 3; return raw.id + " " + sub.v + " " + ((t as unknown) === raw) + " " + madeHolder.id });
