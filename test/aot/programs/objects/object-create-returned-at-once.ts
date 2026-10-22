// `return Object.create(p)`: in strict code the call stands in tail position. What it makes is the object that `const made = Object.create(p); return made` makes:
// with accessors defined on it later, as a dictionary, below null, below a function, and with the TypeError of the built-in for what is no prototype.
interface Sized { size: number }
function create(p: object | null): any { return Object.create(p); }
function createTyped(p: object | null): Sized { return Object.create(p); }
function createKept(p: object | null): any { const made = Object.create(p); return made; }
const createArrow = (p: any) => Object.create(p);
class Factory { base = { inherited: 1 }; make(): any { return Object.create(this.base); } }

function describe(made: any): string {
  const names: string[] = [];
  for (const name in made) names.push(name);
  return JSON.stringify([Object.keys(made), names, Object.getPrototypeOf(made) === null ? "null" : typeof Object.getPrototypeOf(made), made.size, made.inherited]);
}

const proto = { inherited: 1 };
for (let round = 0; round < 3; round++) {
  for (const make of [create, createTyped, createKept, createArrow]) {
    const withGetter = make(proto);
    let reads = 0;
    Object.defineProperty(withGetter, "size", { get() { return ++reads + round; }, enumerable: true, configurable: true });
    const withValues = make(proto);
    withValues.size = round; withValues["key" + round] = true;
    const belowNull = make(null);
    belowNull.size = "none";
    const belowFunction = make(describe);
    console.log(round, make.name, describe(withGetter), withGetter.size, reads, describe(withValues), describe(belowNull), "toString" in belowNull, typeof belowFunction.call, describe(make(withGetter)));
    delete withGetter.size;
    console.log(describe(withGetter), Object.isExtensible(withGetter), withGetter instanceof Object, belowNull instanceof Object);
  }
  console.log(describe(new Factory().make()));
}
for (const make of [create, createTyped, createKept, createArrow]) {
  for (const wrong of [undefined, 1, "text", true, Symbol.iterator] as any[]) {
    try { make(wrong); console.log("made"); } catch (error) { console.log(make.name, typeof wrong, (error as Error).constructor.name, (error as Error).message); }
  }
}
