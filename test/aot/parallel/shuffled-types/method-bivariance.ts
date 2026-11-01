// A method that asks for a derived class stands in for one that takes the base, and is handed the base. The types that the compiler expects are shuffled: they may cost time and decide nothing.
// Flags: --aot-testing=ShuffleExpectedTypes
function show(...values: unknown[]) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
class Animal { name = "a"; } class Dog extends Animal { loud = 3; }
interface Keeper { keep(a: Animal): number }
class DogKeeper implements Keeper { keep(d: Dog): number { return d.loud + 1; } }
function run(k: Keeper, a: Animal): number { return k.keep(a); }
for (let i = 0; i < 30; i++) run(new DogKeeper(), new Dog());
show(run(new DogKeeper(), new Animal()));
export {};
