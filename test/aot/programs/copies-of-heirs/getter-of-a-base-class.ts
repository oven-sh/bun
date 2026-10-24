// The getter stands two classes up.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name : String(e))) } }
interface S { a: number; b: number }
class Base { get b(): number { return 2 } }
class Middle extends Base {}
class C extends Middle implements S { a = 1 }
const copy = (s: S): S => ({ ...s });
row("the instance", () => new C().b);
row("the copy", () => copy(new C()).b + 1);
