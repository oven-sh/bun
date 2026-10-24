// Getters, setters and attributes are defined over the fields of records, and typed code reads and stores.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
function parse(t: string): any { return JSON.parse(t) }
type Item = { id: number; n: number; tag?: string };
function read(x: Item): number { return x.n }
function write(x: Item, v: number): number { x.n = v; return x.n }
row("a getter defined over a field", () => { const t: Item = { id: 1, n: 1 }; let calls = 0; Object.defineProperty(t, "n", { get() { calls++; return 42 }, configurable: true, enumerable: true }); return read(t) + " " + calls });
row("a setter defined over a field", () => { const t: Item = { id: 1, n: 1 }; let seen = 0; Object.defineProperty(t, "n", { get() { return 1 }, set(v) { seen = v }, configurable: true }); write(t, 9); return seen });
row("a field made read-only", () => { const t: Item = { id: 1, n: 1 }; Object.defineProperty(t, "n", { writable: false }); let s = ""; try { write(t, 9) } catch (e) { s = (e as Error).name } return s + " " + t.n });
row("a field made not enumerable", () => { const t: Item = { id: 1, n: 1 }; Object.defineProperty(t, "n", { enumerable: false }); return Object.keys(t).join() + " " + JSON.stringify(t) + " " + read(t) });
row("the descriptor of a field", () => JSON.stringify(Object.getOwnPropertyDescriptor({ id: 1, n: 1 } as Item, "n")));
row("plain data with a getter held to the type", () => { let calls = 0; const r: any = { id: 1, get n() { calls++; return 7 } }; const t: Item = hide(r); return read(t) + " " + read(t) + " " + calls + " " + ((t as unknown) === r) });
row("plain data with a read-only property held to the type", () => { const r: any = Object.defineProperty({ id: 1 }, "n", { value: 7, enumerable: true }); const t: Item = hide(r); let s = ""; try { write(t, 9) } catch (e) { s = (e as Error).name } return s + " " + r.n });
row("defineProperty of a new name on a record", () => { const t: Item = { id: 1, n: 1 }; Object.defineProperty(t, "z", { value: 3, enumerable: true }); return Object.keys(t).join() + " " + hide(t).z });
