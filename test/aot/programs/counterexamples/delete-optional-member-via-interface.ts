// An instance is seen through an interface in which one of its fields is optional, and that field is deleted.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
class R { ok = true; n = 1 }
interface G { ok?: boolean; n: number }
row("delete through an interface", () => { const r: G = hide(new R()); delete r.ok; return String("ok" in r) });
