// A literal with a getter under a required name goes into a Map and into a field of its type.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
interface V { n: number }
row("an accessor under a required name, in a Map", () => { const m = new Map<string, V>(); m.set("k", { get n() { return 4 } }); return m.get("k")!.n });
row("the same in a field", () => { class H { v: V; constructor(v: V) { this.v = v } } return new H({ get n() { return 5 } }).v.n });
