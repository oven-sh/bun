// A class extends a plain function that is cast to a constructor type.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
function F(this: any) { this.a = 1 }
interface C { a: number }
row("extends (F as unknown as C)", () => { class Sub extends (F as unknown as new () => C) { b = 2 } const s = new Sub(); return s.a + s.b });
