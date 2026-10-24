// A field of type number gets a string, undefined, null or nothing through `any`, `Object.assign` and parsed JSON. Every store succeeds. A typed read of the string throws a TypeError; undefined, null and a missing field pass.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name : String(e))) } }
function hide(v: unknown): any { return v }
function parse(t: string): any { return JSON.parse(t) }
type Item = { id: number; n: number; tag?: string };
function read(x: Item): string { return typeof x.n }
row("a string stored to a number's field through any", () => { const t: Item = { id: 1, n: 1 }; hide(t).n = "seven"; return read(t) + " " + hide(t).n });
row("delete of a required field through any", () => { const t: Item = { id: 1, n: 1 }; const was = delete hide(t).n; return was + " " + read(t) + " " + Object.keys(t).join() });
row("undefined stored to a required field through any", () => { const t: Item = { id: 1, n: 1 }; hide(t).n = undefined; return read(t) });
row("Object.assign with another kind", () => { const t: Item = { id: 1, n: 1 }; Object.assign(t, hide({ n: "x" })); return read(t) });
row("plain data that does not satisfy the type", () => { const t: Item = parse('{"id":1,"n":"x"}'); return read(t) });
row("plain data that lacks a required field", () => { const t: Item = parse('{"id":1}'); return read(t) });
row("null where the type has none", () => { const t: Item = parse('{"id":1,"n":null}'); return read(t) });
