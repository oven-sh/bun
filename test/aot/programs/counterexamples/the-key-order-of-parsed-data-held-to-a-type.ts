// Parsed JSON with its keys in another order than the type, and with more keys, keeps them.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
function parse(t: string): any { return JSON.parse(t) }
interface Sub { v: number }
interface Item { id: string; n: number; sub: Sub | null }
const made: Item[] = [{ id: "m", n: 0.5, sub: { v: 1 } }, { id: "m", n: 1, sub: null }];
function bump(x: Item): number { x.n += 1; return x.n }
function kind(x: Item): string { return typeof x.n }
row("(made by typed code)", () => bump(made[0]) + bump(made[1]));
const text = '{"id":"s","n":7,"sub":null}';
row("the order of the keys of data, and more than the type says", () => { const held = parse('{"z":null,"sub":null,"n":1,"more":{"deep":[1,2]},"id":"s"}'); const t: Item = held; bump(t); return Object.keys(held).join() + " " + JSON.stringify(held) + " " + JSON.stringify(t) });
