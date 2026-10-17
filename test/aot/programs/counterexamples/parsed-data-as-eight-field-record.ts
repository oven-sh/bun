// Parsed JSON held to a record of eight fields stays the same object, and a store through the type is seen through the data.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
interface Big { a: number; b: number; c: number; d: number; e: number; f: number; g: number; h: number }
const made = ((n: number): Big => ({ a: n, b: n, c: n, d: n, e: n, f: n, g: n, h: n }))(0);
row("plain data held to a record of eight fields", () => { const r = JSON.parse('{"a":1,"b":1,"c":1,"d":1,"e":1,"f":1,"g":1,"h":1}'); const t: Big = r; t.a = 9; return r.a + " " + ((t as unknown) === r) + " " + made.a });
