// A copy of an object with a getter calls it where its key stands, and goes on with what the getter left.
function digest(object) {
  return Reflect.ownKeys(object).map(key => String(key) + "=" + String(object[key])).join();
}
let sum = 0;
const plain = { a: 1, b: 2, get c() { return "three"; }, d: 4 };
for (let i = 0; i < 3000; i++) sum = (sum + Object.keys({ ...plain }).length) % 1000003;
console.log(sum, digest({ ...plain }), Object.getOwnPropertyDescriptor({ ...plain }, "c").value);
function attempt(name, make) {
  try {
    const made = make();
    console.log(name, digest({ ...made }));
  } catch (error) {
    console.log(name, "threw", error.message);
  }
}
const seen = [];
attempt("order", () => ({
  get a() { seen.push("a"); return 1; },
  b: 2,
  get c() { seen.push("c"); return 3; },
  [Symbol.for("s")]: 4,
  get [Symbol.for("t")]() { seen.push("t"); return 5; },
}));
console.log(seen.join());
attempt("deletes a later key", () => {
  const made = { get a() { delete this.b; return 1; }, b: 2, c: 3 };
  return made;
});
attempt("deletes an earlier key", () => {
  const made = { z: 0, get a() { delete this.z; return 1; }, c: 3 };
  return made;
});
attempt("adds a key", () => ({ get a() { this.added = 1; return 1; }, b: 2 }));
attempt("changes a later value", () => ({ get a() { this.b = "changed"; return 1; }, b: 2 }));
attempt("hides a later key", () => ({ get a() { Object.defineProperty(this, "b", { enumerable: false }); return 1; }, b: 2, c: 3 }));
attempt("turns a later key into a getter", () => ({ get a() { Object.defineProperty(this, "b", { get() { return "got"; } }); return 1; }, b: 2 }));
attempt("freezes", () => ({ get a() { Object.freeze(this); return 1; }, b: 2 }));
attempt("throws", () => ({ a: 1, get b() { throw new RangeError("from a getter"); }, c: 3 }));
attempt("private name", () => {
  class Base { constructor(object) { return object; } }
  class Stamp extends Base { #hidden = 1; static has(object) { return #hidden in object; } }
  const made = { get a() { return 1; }, b: 2 };
  new Stamp(made);
  console.log("stamped", Stamp.has(made), Stamp.has({ ...made }));
  return made;
});
attempt("names outside", () => {
  const made = { get a() { return 1; }, b: 2 };
  made.late = 3;
  made["later" + 1] = 4;
  return made;
});
attempt("a getter outside", () => {
  const made = { a: 1 };
  Object.defineProperty(made, "late", { get() { return "late"; }, enumerable: true });
  return made;
});
attempt("elements", () => ({ get a() { return 1; }, 1: "one", 0: "zero" }));
attempt("hidden", () => Object.defineProperty({ get a() { return 1; }, b: 2 }, "b", { enumerable: false }));
attempt("__proto__", () => ({ get a() { return 1; }, ["__proto__"]: 2 }));
attempt("into a literal", () => ({ ...{ get a() { return 1; }, b: 2 }, c: 3 }));
class Point { x = 1; get y() { return 2; } }
attempt("instance", () => new Point());
console.log("over accessors", Object.getOwnPropertyDescriptor({ get b() { return "mine"; }, ...{ get a() { return 1; }, b: 2 } }, "b").value);
const typed = { get a() { return 1; }, b: "text" };
console.log(digest(Object.assign({}, typed)), digest(Object.assign({ b: "under", z: 0 }, typed)));
const { b, ...rest } = typed;
console.log(b, digest(rest));
