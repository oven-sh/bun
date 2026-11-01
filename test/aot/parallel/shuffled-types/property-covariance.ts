// A field of a derived class gets an object of a sibling class through a wider second name. The types that the compiler expects are shuffled: they may cost time and decide nothing.
// Flags: --aot-testing=ShuffleExpectedTypes
function show(...values: unknown[]) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
class Animal { name = "a"; } class Dog extends Animal { loud = 1; bark(): string { return "woof" + this.loud; } } class Cat extends Animal { lives = 9; }
function hear(h: { pet: Dog }): string { return h.pet.bark() + h.pet.loud; }
const home: { pet: Dog } = { pet: new Dog() }; for (let i = 0; i < 30; i++) hear({ pet: new Dog() });
const any1: { pet: Animal } = home; any1.pet = new Cat(); let r7: unknown; try { r7 = hear(home); } catch (e) { r7 = "throws " + (e as Error).constructor.name; } show(r7, (home.pet as Animal).name);
export {};
