// A list of a derived class gets an object of a sibling class through a second name under which it is a list of the base. The types that the compiler expects are shuffled: they may cost time and decide nothing.
// Flags: --aot-testing=ShuffleExpectedTypes
function show(...values: unknown[]) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
class Animal { name = "a"; } class Dog extends Animal { bark(): string { return "woof" + this.loud; } loud = 1; } class Cat extends Animal { lives = 9; }
function barks(ds: Dog[]): string { let s = ""; for (const d of ds) s += d.bark(); return s; }
function louds(ds: Dog[]): number { let s = 0; for (let i = 0; i < ds.length; i++) s += ds[i]!.loud; return s; }
const dogs: Dog[] = [new Dog()]; for (let i = 0; i < 30; i++) { barks([new Dog()]); louds([new Dog()]); }
const animals: Animal[] = dogs; animals.push(new Cat()); let r6: unknown; try { r6 = barks(dogs); } catch (e) { r6 = "throws " + (e as Error).constructor.name; } show(r6, louds(dogs));
export {};
