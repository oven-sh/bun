// Array.prototype.join called where the compiler tests nothing in front of the call: the function runs a few times and knows nothing of its receiver.
// Whatever way the run time takes, the answer, the order of what the program can see and the errors are the engine's.
const join = Array.prototype.join;
const log = [];
function joined(receiver, ...rest) {
  try {
    const text = join.call(receiver, ...rest);
    return typeof text + ":" + (text.length > 60 ? text.length + ":" + text.slice(0, 20) + ".." + text.slice(-20) : JSON.stringify(text));
  } catch (error) {
    return "throws " + error.constructor.name + (error instanceof RangeError ? ": " + error.message : "");
  }
}
function withOne(receiver, separator) {
  try {
    const text = join.call(receiver, separator);
    return typeof text + ":" + (text.length > 60 ? text.length + ":" + text.slice(0, 20) + ".." + text.slice(-20) : JSON.stringify(text));
  } catch (error) {
    return "throws " + error.constructor.name + (error instanceof RangeError ? ": " + error.message : "");
  }
}
function withNone(receiver) {
  try {
    const text = join.call(receiver);
    return typeof text + ":" + (text.length > 60 ? text.length + ":" + text.slice(0, 20) + ".." + text.slice(-20) : JSON.stringify(text));
  } catch (error) {
    return "throws " + error.constructor.name + (error instanceof RangeError ? ": " + error.message : "");
  }
}
const long = [];
for (let i = 0; i < 40; i++) long.push(String.fromCharCode(97 + (i % 26)).repeat(700 + i));
const wide = long.map((text, i) => (i === 7 ? text + "☃" : text));
const holes = ["a", , "c"];
const sparse = [];
sparse[100000] = "end";
class Mine extends Array {}
const mine = Mine.from(long);
const cyclic = ["x"];
cyclic.push(cyclic);
const separator = {
  toString() {
    log.push("separator asked");
    return "<>";
  },
};
const arrayLike = {
  get length() {
    log.push("length asked");
    return 3;
  },
  get 0() {
    log.push("0 asked");
    return "zero";
  },
  1: null,
  2: { toString: () => "two" },
};
const receivers = {
  long,
  wide,
  "one long string": [long[3]],
  "long strings and a number": [...long, 5],
  "long strings and undefined": [...long, undefined, null],
  "long strings and an object": [...long, { toString: () => "object" }],
  holes,
  sparse,
  mine,
  cyclic,
  empty: [],
  integers: [1, 2, 3],
  doubles: [1.5, -0, NaN, 1e21],
  "doubles with a hole": [1.5, , 2.5],
  frozen: Object.freeze([...long]),
  arrayLike,
  string: "text",
  number: 5,
  typed: new Uint8Array([1, 2, 3]),
  proxy: new Proxy(["p", "q"], {
    get(target, key, self) {
      log.push("proxy " + String(key));
      return Reflect.get(target, key, self);
    },
  }),
  null: null,
  undefined: undefined,
  "throws in an element": ["a", { toString() { throw new RangeError("element"); } }],
  symbol: [Symbol("s")],
};
for (const [name, receiver] of Object.entries(receivers)) {
  console.log(name, "|", withNone(receiver), "|", withOne(receiver, ","), "|", withOne(receiver, ""), "|", withOne(receiver, undefined), "|", withOne(receiver, "—"));
  console.log(name, "|", withOne(receiver, separator), "|", withOne(receiver, 7), "|", withOne(receiver, null), "|", joined(receiver, "-", "ignored"), "|", log.splice(0).join(" "));
}
// An element that a prototype has where the array has a hole.
const inherits = ["a", , "c"];
Object.setPrototypeOf(inherits, { __proto__: Array.prototype, 1: "from the prototype" });
const numbersInherit = [1.5, , 2.5];
Object.setPrototypeOf(numbersInherit, { __proto__: Array.prototype, 1: "from the prototype" });
console.log(withOne(inherits, "+"), withOne(numbersInherit, "+"), withNone(inherits), withOne(holes, "+"));
// What is joined is a string like any other.
const text = join.call(long, "\n");
console.log(text.length, text.indexOf("\n"), text.split("\n").length, text === long.join("\n"), text.charCodeAt(701), { [text]: 1 }[long.join("\n")]);
// The array changes behind the join.
const changing = [...long];
const before = join.call(changing, ",");
changing[0] = "changed";
changing.length = 2;
console.log(before.length, before.slice(0, 5), join.call(changing, ",").length);
