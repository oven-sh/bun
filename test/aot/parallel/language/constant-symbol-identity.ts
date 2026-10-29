// Symbol() at the top level of a module is one symbol wherever it is read, Symbol.for() agrees with the registry, and Symbol() in a loop or a function is new each time.
export {};

const same = (left: unknown, right: unknown): boolean => left === right;

const key = Symbol("x");
function readInOneFunction(): symbol {
  return key;
}
function readInAnotherFunction(): symbol {
  return key;
}
console.log("read from two functions:", readInOneFunction() === readInAnotherFunction(), readInOneFunction() === key, typeof readInOneFunction(), readInAnotherFunction().toString());

const keyed = { [key]: "symbol key", x: "string key" };
function readKeyed(): string {
  return keyed[key];
}
function writeKeyed(value: string): void {
  keyed[key] = value;
}
console.log("as a key:", readKeyed(), keyed.x, key in keyed, Object.getOwnPropertySymbols(keyed).length, Object.getOwnPropertySymbols(keyed)[0] === key, Object.keys(keyed).join());
writeKeyed("stored");
console.log("after a store:", readKeyed(), Reflect.get(keyed, readInAnotherFunction()), keyed.x, Object.getOwnPropertySymbols(keyed).length);

class Keyed {
  [key] = "field";
  static [key] = "static field";
}
console.log("in a class:", new Keyed()[key], Keyed[key], Reflect.get(new Keyed(), readInOneFunction()));

const withoutDescription = Symbol();
const withEmptyDescription = Symbol("");
const accented = Symbol("é");
const wide = Symbol("日本語 😀");
const loneSurrogate = Symbol("\ud800");
console.log("descriptions:", withoutDescription.description === undefined, JSON.stringify(withEmptyDescription.description), accented.description, wide.description, JSON.stringify(loneSurrogate.description));
console.log("as strings:", withoutDescription.toString(), withEmptyDescription.toString(), accented.toString(), wide.toString());
console.log("no description and an empty one:", same(withoutDescription, withEmptyDescription), same(withoutDescription, Symbol()), same(withEmptyDescription, Symbol("")));

const registered = Symbol.for("k");
const registeredByComputedKey = Symbol.for(["", "k"].join(""));
console.log("Symbol.for, constant key first:", same(registered, registeredByComputedKey), Symbol.keyFor(registered), Symbol.keyFor(registeredByComputedKey), registered.description);
const earlierByComputedKey = Symbol.for(["ear", "lier"].join(""));
const laterByConstantKey = Symbol.for("earlier");
console.log("Symbol.for, computed key first:", same(earlierByComputedKey, laterByConstantKey), Symbol.keyFor(laterByConstantKey));
console.log("Symbol.for, other keys:", JSON.stringify(Symbol.keyFor(Symbol.for(""))), same(Symbol.for(""), Symbol.for([].join(""))), Symbol.keyFor(Symbol.for("é")), same(Symbol.for("é"), Symbol.for(["é"].join(""))));

function countRegistered(iterations: number): number {
  const seen = new Set<symbol>();
  for (let i = 0; i < iterations; i++) seen.add(Symbol.for("in a loop"));
  return seen.size;
}
console.log("Symbol.for in a loop:", countRegistered(3), same(Symbol.for("in a loop"), Symbol.for(["in", "a", "loop"].join(" "))));
console.log("not registered:", Symbol.keyFor(key), Symbol.keyFor(withoutDescription), same(key, Symbol.for("x")), same(registered, Symbol("k")));

const first = Symbol("x");
const second = Symbol("x");
console.log("two top-level symbols, one description:", same(first, second), same(first, key), same(second, key), first.description === second.description);
const keyedByBoth = { [first]: 1, [second]: 2 };
console.log("two keys:", keyedByBoth[first], keyedByBoth[second], Object.getOwnPropertySymbols(keyedByBoth).length, Reflect.has(keyedByBoth, key));

const fromLoop: symbol[] = [];
for (let i = 0; i < 3; i++) fromLoop.push(Symbol("x"));
console.log("in a loop:", new Set(fromLoop).size, fromLoop[0] === fromLoop[1], fromLoop[1] === fromLoop[2], same(fromLoop[0], first));

const create = (): symbol => Symbol("x");
console.log("in a function:", create() === create(), same(create(), first), create().description);
