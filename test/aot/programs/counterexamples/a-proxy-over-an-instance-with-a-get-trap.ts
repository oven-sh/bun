// A method is called on a Proxy over an instance whose `get` trap forwards to `Reflect.get`.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
class Fuse { list: string[]; constructor(list: string[]) { this.list = list } count(): number { return this.list.length } }
row("a Proxy over an instance", () => { const p = new Proxy(new Fuse(["a", "b"]), { get(t, k, r) { return Reflect.get(t, k, r) } }); return p.count() });
