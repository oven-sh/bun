// The list of own keys is the same however it is used.
const lines = [];
const say = (...parts) => lines.push(parts.join(" "));

const shape = { a: 1, b: 2, c: 3, d: 4, e: 5 };
say("measured", Object.keys(shape).length);
say("joined", Object.keys(shape).join());
say("searched", Object.keys(shape).includes("c"), Object.keys(shape).includes("z"), Object.keys(shape).indexOf("e"));
say("each call makes a list", Object.keys(shape) !== Object.keys(shape));

const changed = Object.keys(shape);
changed.push("more");
changed[0] = "first";
say("a list that is changed", changed.join(), Object.keys(shape).join());

function listOf(value) {
  return Object.keys(value).join() + ":" + Object.keys(value).length;
}
say("in the order of creation", listOf({ z: 1, y: 2, x: 3 }), listOf({ x: 3, y: 2, z: 1 }));
say("indexes first", listOf({ b: 1, 2: 1, a: 1, 1: 1, "-1": 1, "01": 1 }));
say("no symbols", listOf({ a: 1, [Symbol("s")]: 2, [Symbol.iterator]: 3, b: 4 }));
say("accessors are listed and not run", listOf({ a: 1, get b() { say("the getter ran"); return 2; }, set c(value) {}, d: 4 }));
say("methods", listOf({ a() {}, b: () => 1, async c() {}, *d() {} }));
say("nothing inherited", listOf(Object.create({ above: 1 })), listOf(Object.assign(Object.create({ above: 1 }), { own: 2 })));

function optional(withMiddle) {
  const made = { first: 1 };
  if (withMiddle) made.middle = 2;
  made.last = 3;
  return made;
}
say("a name that is added at times", listOf(optional(true)), listOf(optional(false)));

const emptied = { a: 1, b: 2, c: 3 };
delete emptied.b;
say("behind a delete", listOf(emptied));
emptied.b = 4;
say("added again", listOf(emptied));

const hidden = { a: 1, b: 2, c: 3 };
Object.defineProperty(hidden, "b", { enumerable: false });
say("a name that is hidden", listOf(hidden));
Object.defineProperty(hidden, "d", { value: 4 });
Object.defineProperty(hidden, "e", { value: 5, enumerable: true });
say("names that are defined", listOf(hidden));
say("frozen and sealed", listOf(Object.freeze({ a: 1, b: 2 })), listOf(Object.seal({ c: 1 })));

class Point {
  x = 1;
  y = 2;
  #secret = 3;
  static origin = 0;
  get length() { return this.#secret; }
  move() {}
}
class Point3 extends Point {
  z = 3;
}
say("instances", listOf(new Point()), listOf(new Point3()), listOf(Point), listOf(Point.prototype));

say("what is no object of the program", listOf([7, 8]), listOf("ab"), listOf(5), listOf(true), listOf(function named(a) {}), listOf(new Map([[1, 2]])));
for (const nothing of [undefined, null]) {
  try {
    Object.keys(nothing);
  } catch (error) {
    say("of nothing", error instanceof TypeError);
  }
}
say("behind a proxy", listOf(new Proxy({ a: 1, b: 2 }, { ownKeys() { return ["b", "a"]; } })));

const many = [{ a: 1, b: 2 }, { b: 2, a: 1 }, { a: 1 }, {}, new Point(), [1], optional(true)];
let counted = 0;
for (let i = 0; i < 700; i++) counted += Object.keys(many[i % many.length]).length;
say("counted", counted);

let read = 0;
for (let i = 0; i < 100; i++) for (const key of Object.keys(shape)) read += shape[key];
say("read by its keys", read);

const growing = {};
const lengths = [];
for (const name of ["p", "q", "r"]) {
  growing[name] = 1;
  lengths.push(Object.keys(growing).length);
}
say("while it grows", lengths.join());

console.log(lines.join("\n"));
