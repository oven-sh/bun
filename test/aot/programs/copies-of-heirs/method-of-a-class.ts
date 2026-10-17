// A copy of an instance lacks the methods of its class; behind an interface TypeScript takes them for copied.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name : String(e))) } }
interface S { a: number; twice(): number }
class C implements S { a = 2; twice(): number { return this.a * 2 } }
const copy = (s: S): S => ({ ...s });
row("the instance", () => new C().twice());
row("the method", () => typeof copy(new C()).twice);
row("called", () => copy(new C()).twice());
row("a copy of a literal", () => copy({ a: 3, twice() { return this.a * 2 } }).twice());
