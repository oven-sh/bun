// Literals as libraries write them: a descriptor below null with a method, an object of exports with accessors beside plain names, at the top level (run once) and in functions (run often).
// Objects of the same places are changed afterwards in every way that takes a field out of its slot, and the places run again.
const lines = [];
const keysOf = object => Reflect.ownKeys(object).map(String).join();
const describe = object => keysOf(object) + " | " + JSON.stringify(Object.getOwnPropertyDescriptors(object), (key, value) => typeof value === "function" ? "function " + value.name : typeof value === "symbol" ? String(value) : value);
let calls = 0;
const next = () => ++calls;

const descriptor = { __proto__: null, configurable: true, enumerable: true, get() { return "got " + this.tag; }, tag: "top" };
const api = {
  get lazy() { return "lazy " + this.plain; },
  plain: "p" + next(), count: next(), mark: Symbol.for("mark"),
  set both(value) { this.count = value; }, get both() { return this.count; },
  run() { return "run " + this.plain; }, list: [next()], nothing: undefined, none: null, last: next(),
};
lines.push("descriptor: " + describe(descriptor) + " | " + descriptor.get() + " | " + String(Object.getPrototypeOf(descriptor)));
lines.push("api: " + describe(api) + " | " + api.lazy + " | " + api.run() + " | " + api.both);

function makeDescriptor(tag) { return { __proto__: null, configurable: true, enumerable: tag !== "b", get() { return "got " + this.tag; }, tag }; }
function makeApi(i) {
  return {
    get lazy() { return "lazy " + this.plain; },
    plain: "p" + i, count: i, mark: Symbol.for("mark"),
    set both(value) { this.count = value; }, get both() { return this.count; },
    run() { return "run " + this.plain; }, list: [i], nothing: undefined, none: null, last: i + 1,
  };
}
function below(parent, i) { return { __proto__: parent, own: i, run() { return super.run() + " below " + this.own; }, after: i + 1 }; }
function check(label) {
  const made = makeApi(7), madeDescriptor = makeDescriptor("a"), heir = below(made, 3);
  lines.push(label + ": " + describe(made) + " | " + made.lazy + " | " + made.run() + " | " + describe(madeDescriptor) + " | " + madeDescriptor.get() + " | " + describe(heir) + " | " + heir.run() + " | " + heir.lazy + " | " + Object.isFrozen(made) + Object.isSealed(madeDescriptor) + Object.isExtensible(heir));
  return [made, madeDescriptor, heir];
}
let [made, madeDescriptor, heir] = check("first");
for (let i = 0; i < 200; i++) { makeApi(i); makeDescriptor("b"); below(made, i); }
made.plain = 12; made.count = "text"; made.mark = 1.5; made.list = "no list"; made.last = { object: true };
madeDescriptor.get = 4; madeDescriptor.tag = 5; heir.own = "own"; heir.after = null;
[made, madeDescriptor, heir] = check("after stores of other types");
delete made.plain; delete made.run; delete madeDescriptor.get; delete heir.after;
[made, madeDescriptor, heir] = check("after deletes");
Object.defineProperty(made, "count", { get() { return "redefined"; }, configurable: true });
Object.defineProperty(made, "last", { value: 1, writable: false });
Object.defineProperty(madeDescriptor, "tag", { value: "hidden", enumerable: false });
[made, madeDescriptor, heir] = check("after redefinitions");
Object.freeze(made); Object.seal(madeDescriptor); Object.preventExtensions(heir);
[made, madeDescriptor, heir] = check("after freezing");
Object.setPrototypeOf(made, { inherited: 1 }); Object.setPrototypeOf(madeDescriptor, made);
[made, madeDescriptor, heir] = check("after other prototypes");
made.extra = 1; madeDescriptor.extra = 2; heir[Symbol.iterator] = 3;
check("after extra properties");
console.log(lines.join("\n"));
