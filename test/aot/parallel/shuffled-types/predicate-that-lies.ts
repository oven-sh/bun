// A type predicate says derived class of an object of the base. The types that the compiler expects are shuffled: they may cost time and decide nothing.
// Flags: --aot-testing=ShuffleExpectedTypes
function show(...values: unknown[]) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
class Animal { name = "a"; } class Dog extends Animal { loud = 3; bark(): string { return "woof" + this.loud; } }
function isDog(a: Animal): a is Dog { return true; }
function f18(a: Animal): unknown { if (isDog(a)) return [a.loud, a.loud + 1]; return "no"; }
function g18(a: Animal): unknown { if (isDog(a)) return a.bark(); return "no"; }
for (let i = 0; i < 30; i++) { f18(new Dog()); g18(new Dog()); }
let r18: unknown; try { r18 = g18(new Animal()); } catch (e) { r18 = "throws " + (e as Error).constructor.name; } show(f18(new Animal()), r18);
export {};
