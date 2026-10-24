// `flag("x", false)` with `flag<T>(name, fallback: T): T` may return true: T is not the type of the literal.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
const store: Record<string, { value: any }> = JSON.parse('{"x":{"value":true},"n":{"value":7},"s":{"value":"on"},"o":{"value":{"a":1}}}');
function lookUp<T>(name: string, fallback: T): { value: T } { return store[name] ?? { value: fallback } }
function flag<T>(name: string, fallback: T): T { return lookUp(name, fallback).value }
const other = (store.none !== undefined) as boolean;
row("false as the fallback, in a test", () => { if (flag("x", false) || other) return "taken"; return "not taken" });
row("false as the fallback, as a value", () => String(flag("x", false)));
row("0 as the fallback", () => flag("n", 0) + 1);
row("the empty string as the fallback", () => flag("s", "") + "!");
row("null as the fallback", () => JSON.stringify(flag("o", null)));
row("in a condition that is negated", () => (!flag("x", false) ? "off" : "on"));
row("kept in a const", () => { const on = flag("x", false); return on ? "on" : "off" });
row("absent: the fallback", () => String(flag("y", false)) + flag("z", 0));
row("0 kept in a const", () => { const n = flag("n", 0); return n + 1 });
row("a Promise of false", () => { const p: Promise<boolean> = Promise.resolve(flag("x", false)); return typeof p });
