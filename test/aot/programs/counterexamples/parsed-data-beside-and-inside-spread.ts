// Parsed JSON is a member beside a spread, is inside what is spread, and is spread over a typed object.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
function parse(t: string): any { return JSON.parse(t) }
interface Point { x: number; y: number }
interface Holder { id: string; at: Point | null; was?: Point | null }
const madePoint: Point = { x: 0.5, y: 1 }; const base: Holder = { id: "b", at: madePoint };
function move(h: Holder): number { h.at!.x += 1; return h.at!.x }
row("(made by typed code)", () => move(base));
row("plain data as a member beside a spread", () => { const raw = parse('{"x":1,"y":2}'); const p: Holder = { ...base, at: raw }; return move(p) + " " + raw.x });
row("plain data inside what is spread", () => { const raw = parse('{"id":"r","at":{"x":1,"y":2}}'); const p: Holder = { ...raw, was: null }; return move(p) + " " + raw.at.x });
row("plain data spread over typed", () => { const raw = parse('{"at":{"x":1,"y":2}}'); const p: Holder = { ...base, ...raw }; return move(p) + " " + raw.at.x });
row("Object.assign of plain data onto typed", () => { const raw = parse('{"at":{"x":1,"y":2}}'); const p: Holder = { id: "p", at: null }; Object.assign(p, raw); return move(p) + " " + raw.at.x });
