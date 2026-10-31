// A literal with numbers among its names keeps them in a second object. A spread copies that object's storage at once and asks for no key.
// COUNT: counter:CopiesByOrdinaryLookups <= 60
function digest(object) {
  let text = "";
  for (const key of Reflect.ownKeys(object)) text += String(key) + "=" + (typeof object[key] === "function" ? "a function" : String(object[key])) + ";";
  return text;
}
let sum = 0;
function source(i) {
  return { a: i, b: "b", 0: "zero", 1: i, c: 2.5, 7: "seven" };
}
for (let i = 0; i < 3000; i++) {
  const copy = { ...source(i) };
  sum = (sum + copy.a + copy[1] + Object.keys(copy).length) % 1000003;
}
console.log(sum);
const first = source(1);
const copy = { ...first };
copy[0] = "changed";
copy[2] = "new element";
delete copy[7];
copy.a = 100;
copy.d = "added";
first[1] = "changed in the source";
first[9] = "new in the source";
delete first.b;
console.log("source", digest(first));
console.log("copy", digest(copy));
console.log("again", digest({ ...copy }), digest({ ...first }));
console.log("behind", digest({ z: 1, 0: "under", ...copy }), digest({ ...copy, 0: "over", z: 1 }));
function kinds(name, make) {
  const made = make();
  const taken = { ...made };
  console.log(name, digest(taken), Object.isFrozen(taken), Object.isExtensible(taken), Object.getPrototypeOf(taken) === Object.prototype);
  taken[0] = "written";
  taken.extra = 1;
  console.log(name, "written", digest(taken), digest(made));
}
kinds("sparse", () => ({ a: 1, 5000: "far", 3: "near" }));
kinds("large", () => ({ a: 1, 4294967294: "last", 100000: "far" }));
kinds("only numbers", () => ({ 0: "zero", 1: "one" }));
kinds("fractions", () => ({ a: 1, 0: 0.5, 1: 1.5 }));
kinds("holes", () => {
  const made = { a: 1, 0: "x", 1: "y", 2: "z" };
  delete made[1];
  return made;
});
kinds("getter among elements", () => {
  let asked = 0;
  return { a: 1, 0: "x", get 1() { return ++asked; }, 2: "z" };
});
kinds("getter among names", () => {
  let asked = 0;
  return { a: 1, 0: "x", get b() { return ++asked; } };
});
kinds("hidden element", () => Object.defineProperty({ a: 1, 0: "x" }, 1, { value: "hidden", enumerable: false, configurable: true, writable: true }));
kinds("read-only element", () => Object.defineProperty({ a: 1, 0: "x" }, 1, { value: "fixed", enumerable: true, configurable: false, writable: false }));
kinds("hidden name", () => Object.defineProperty({ a: 1, 0: "x" }, "hidden", { value: 1, enumerable: false }));
kinds("frozen", () => Object.freeze({ a: 1, 0: "x" }));
kinds("sealed", () => Object.seal({ a: 1, 0: "x" }));
kinds("closed", () => Object.preventExtensions({ a: 1, 0: "x" }));
kinds("symbol", () => ({ a: 1, 0: "x", [Symbol.for("s")]: 2 }));
kinds("many names", () => {
  const made = { a: 1, 0: "x" };
  for (let i = 0; i < 100; i++) made["n" + i] = i;
  return made;
});
kinds("method", () => ({ m() { return this.a; }, a: 2, 0: "x" }));
kinds("below", () => Object.setPrototypeOf({ a: 1, 0: "x" }, { up: 1, 5: "up" }));
class Point { x = 1; 0 = "element"; y = 2; }
kinds("instance", () => new Point());
