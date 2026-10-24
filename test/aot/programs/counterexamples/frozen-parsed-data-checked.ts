// Frozen parsed JSON is held to a type, and a typed store throws.
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
row("frozen data held to a type", () => { const raw = Object.freeze(parse(text)); const t: Item = raw; let s = ""; try { bump(t) } catch (e) { s = (e as Error).name } return s + " " + raw.n + " " + ((t as unknown) === raw) + " " + Object.isFrozen(t) });
