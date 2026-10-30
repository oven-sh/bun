// Object.assign onto an object literal, with literals and other values as sources: setters, getters, __proto__, order, symbols and sources that are no objects.
const log = [];
const note = (label, value) => (log.push(label), value);
const describe = object => Reflect.ownKeys(object).map(key => {
  const d = Object.getOwnPropertyDescriptor(object, key);
  const flags = (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-") + ("writable" in d ? (d.writable ? "w" : "-") : "a");
  return `${String(key)}:${flags}:${"value" in d ? (typeof d.value === "function" ? "f " + d.value.name : JSON.stringify(d.value)) : "accessor"}`;
}).join(" ");
const attempt = (label, run) => {
  try {
    const made = run();
    console.log(label, describe(made), "| proto", Object.getPrototypeOf(made) === Object.prototype, "|", log.splice(0).join());
    return made;
  } catch (error) {
    console.log(label, "throws", error.constructor.name, error.message.replace(/ \(evaluating.*$/, ""), "|", log.splice(0).join());
  }
};

attempt("three literals", () => Object.assign({}, { a: note("a", 1) }, { b: note("b", 2) }));
attempt("onto members", () => Object.assign({ a: 1, b: 2 }, { c: 3 }));
attempt("a member is replaced where it stands", () => Object.assign({ a: 1, b: 2 }, { c: 3, a: 4 }, { b: 5, d: 6 }));
attempt("order of evaluation", () => Object.assign({ a: note("t", 1) }, note("s1", { b: note("b", 2) }), { c: note("c", 3) }));
attempt("getters of a source run in the assignment", () => Object.assign({ a: note("a", 1) }, { get b() { return note("get b", 2); } }, { c: note("c", 3) }));
attempt("a setter of the target takes the value", () => Object.assign({ kept: 0, set a(v) { note("set a " + v); this.kept = v; } }, { a: 5, b: 6 }));
attempt("a getter alone refuses the store", () => Object.assign({ get a() { return 1; } }, { z: note("z", 0), a: 5, b: 6 }));
attempt("__proto__ written in a source names what lies above the source", () => Object.assign({}, { __proto__: { inherited: 1 }, a: 1 }));
attempt("__proto__ as an own member of a source sets what lies above the target", () => Object.assign({ a: 1 }, JSON.parse('{"__proto__": {"x": 1}, "b": 2}')));
attempt("__proto__ computed in a source", () => Object.assign({ a: 1 }, { ["__proto__"]: null, b: 2 }));
attempt("names of Object.prototype", () => Object.assign({}, { toString: 1, constructor: 2, valueOf: 3, hasOwnProperty: 4 }));
attempt("null and undefined are passed over", () => Object.assign({ a: 1 }, null, { b: 2 }, undefined, { c: 3 }));
attempt("primitives", () => Object.assign({}, "ab", 5, true, 10n, Symbol("s"), { c: 3 }));
attempt("an array", () => Object.assign({ 1: "kept", z: 0 }, ["zero", , "two"]));
attempt("symbols come last", () => Object.assign({}, { [Symbol.for("s")]: 1, b: 2 }, { a: 3, [Symbol.for("t")]: 4 }));
attempt("indexes come first", () => Object.assign({ b: 0 }, { 2: "two", a: 1, 0: "zero" }));
attempt("hidden members stay behind", () => Object.assign({}, Object.defineProperty({ a: 1 }, "hidden", { value: 2 })));
attempt("what a source inherits stays behind", () => Object.assign({}, Object.create({ inherited: 1 }, { own: { value: 2, enumerable: true } })));
attempt("read-only members become plain", () => Object.assign({}, Object.freeze({ a: 1 })));
attempt("a spread in the target", () => Object.assign({ ...{ a: 1, b: 2 }, c: 3 }, { b: 4, d: 5 }));
attempt("a spread argument", () => Object.assign({}, ...[{ a: 1 }, { b: 2 }]));
attempt("the target alone", () => Object.assign({ a: 1 }));
attempt("a source throws half way", () => Object.assign({}, { a: 1, get b() { throw new RangeError("no b"); }, c: 3 }));
attempt("methods keep their names", () => Object.assign({}, { run() {}, arrow: () => 1, plain: function () {} }));
let half;
try {
  Object.assign((half = { a: 0 }), { a: 1, b: 2 }, { get c() { throw new RangeError("stop"); } }, { d: 4 });
} catch {}
console.log("what came before the throw is there", describe(half));
const seen = [];
attempt("a getter of a source sees the target half made", () => {
  const target = { a: 1 };
  return Object.assign(target, { b: 2 }, { get c() { seen.push(Object.keys(target).join()); return 3; } }, { d: 4 });
});
console.log(seen.join(" "));
attempt("a source changes while it is copied", () => {
  const source = { get a() { delete this.b; this.c = "late"; return 1; }, b: 2 };
  return Object.assign({}, source);
});
const proxy = new Proxy({ a: 1, b: 2 }, {
  ownKeys: target => note("ownKeys", Reflect.ownKeys(target)),
  getOwnPropertyDescriptor: (target, key) => note("describe " + key, Reflect.getOwnPropertyDescriptor(target, key)),
  get: (target, key) => note("get " + key, target[key]),
});
attempt("a proxy for a source", () => Object.assign({ z: 0 }, proxy));
{
  const Object = { assign: (...all) => ({ mine: all.length }) };
  attempt("another Object", () => Object.assign({}, { a: 1 }, { b: 2 }));
}
const { assign } = Object;
attempt("the function in a variable", () => assign({}, { a: 1 }, { b: 2 }));

function options(given) {
  return Object.assign({}, { depth: 1, color: "red", deep: { x: 1 } }, given);
}
const all = [options(), options({ depth: 2 }), options({ extra: true, color: undefined }), options(null), options("xy")];
console.log("defaults and what is given", all.map(one => JSON.stringify(one)).join(" "));
all[0].deep.x = 2;
console.log("the values are shared, the objects are not", all[1].deep.x, all[0] !== all[1]);
let sum = 0;
for (let turn = 0; turn < 2000; turn++) {
  const made = Object.assign({}, { x: turn }, { y: turn + 1 }, turn % 3 ? { z: 1 } : null);
  sum += made.x + made.y + (made.z ?? 0);
}
console.log("read by name", sum);
const sealed = Object.seal(Object.assign({ a: 1 }, { b: 2 }));
Reflect.set(sealed, "c", 3);
sealed.a = 4;
console.log("sealed at once", JSON.stringify(sealed), Object.isSealed(sealed));
const below = Object.setPrototypeOf(Object.assign({ a: 1 }, { b: 2 }), { inherited: 3 });
console.log("put below another object", below.a + below.b + below.inherited, Object.keys(below).join());
