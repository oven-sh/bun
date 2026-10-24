// An instance of a class that extends an untyped class is held to a type that it satisfies.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
const Base = hide(class { updater = { n: 1 } });
class Derived extends (Base as any) {}
interface U { n: number }
row("heir of an untyped class", () => { const r: { updater: U } = new Derived() as any; return r.updater.n });
