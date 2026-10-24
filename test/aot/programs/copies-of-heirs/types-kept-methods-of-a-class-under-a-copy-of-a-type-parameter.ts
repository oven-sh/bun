// A type parameter is copied somewhere in the program: calls of a class's own methods on its instances stay what they are.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\\n")[0] : String(e))) } }
class Counter { count = 0; add(n: number): number { this.count += n; return this.count } get twice(): number { return this.count * 2 } }
const copy = <T extends object>(value: T): T => ({ ...value });
row("a copy of a literal", () => copy({ x: 1 }).x);
row("the class", () => { const counter = new Counter(); counter.add(2); return counter.add(3) + counter.twice });
