// Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)): accessors, attributes, symbols, order, proxies and what throws on the way.
const log = [];
const note = (label, value) => (log.push(label), value);
const describe = object => Reflect.ownKeys(object).map(key => {
  const d = Object.getOwnPropertyDescriptor(object, key);
  const flags = (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-") + ("writable" in d ? (d.writable ? "w" : "-") : "a");
  return `${String(key)}:${flags}:${"value" in d ? (typeof d.value === "function" ? "f" : JSON.stringify(d.value)) : (d.get ? "get" : "") + (d.set ? "set" : "")}`;
}).join(" ");
const attempt = (label, run) => {
  try {
    const made = run();
    console.log(label, describe(made), "|", log.splice(0).join());
    return made;
  } catch (error) {
    console.log(label, "throws", error.constructor.name, error.message.replace(/ \(evaluating.*$/, ""), "|", log.splice(0).join());
  }
};

attempt("plain members", () => Object.defineProperties({ a: 1 }, Object.getOwnPropertyDescriptors({ b: 2, c: 3 })));
attempt("a member is replaced where it stands", () => Object.defineProperties({ a: 1, b: 2 }, Object.getOwnPropertyDescriptors({ c: 3, a: 4 })));
const lazy = attempt("a getter is not called", () => Object.defineProperties({ a: 1 }, Object.getOwnPropertyDescriptors({ get late() { return note("late runs", this.a + 1); }, b: 2 })));
console.log("it runs on the new object", lazy.late, log.splice(0).join());
const stored = attempt("a setter comes along", () => Object.defineProperties({ kept: 0 }, Object.getOwnPropertyDescriptors({ set value(v) { this.kept = v; }, get value() { return this.kept * 2; } })));
stored.value = 21;
console.log("it stores into the new object", stored.kept, stored.value);
attempt("an accessor takes the place of a value", () => Object.defineProperties({ a: 1, b: 2 }, Object.getOwnPropertyDescriptors({ get a() { return 3; } })));
attempt("a value takes the place of an accessor", () => Object.defineProperties({ get a() { return note("never", 1); }, b: 2 }, Object.getOwnPropertyDescriptors({ a: 3 })));
attempt("hidden, read-only and fixed members", () => {
  const source = {};
  Object.defineProperty(source, "hidden", { value: 1, writable: true, configurable: true });
  Object.defineProperty(source, "readOnly", { value: 2, enumerable: true, configurable: true });
  Object.defineProperty(source, "fixed", { value: 3, enumerable: true, writable: true });
  return Object.defineProperties({ first: 0 }, Object.getOwnPropertyDescriptors(source));
});
attempt("symbols and indexes", () => Object.defineProperties({ z: 0 }, Object.getOwnPropertyDescriptors({ [Symbol.for("s")]: 1, 2: "two", b: 1, 0: "zero" })));
attempt("__proto__ as an own member", () => Object.defineProperties({}, Object.getOwnPropertyDescriptors(JSON.parse('{"__proto__": {"x": 1}, "a": 2}'))));
attempt("what the source inherits stays behind", () => Object.defineProperties({}, Object.getOwnPropertyDescriptors(Object.create({ inherited: 1 }, { own: { value: 2, enumerable: true } }))));
attempt("order of evaluation", () => Object.defineProperties(note("target", {}), Object.getOwnPropertyDescriptors(note("source", { a: 1 }))));
attempt("the source is a string", () => Object.defineProperties({}, Object.getOwnPropertyDescriptors("ab")));
attempt("the source is a number", () => Object.defineProperties({ a: 1 }, Object.getOwnPropertyDescriptors(5)));
attempt("the source is an array", () => Object.defineProperties({}, Object.getOwnPropertyDescriptors([1, , 3])));
attempt("the source is a function", () => Object.defineProperties({}, Object.getOwnPropertyDescriptors(function named(a, b) {})));
attempt("the source is null", () => Object.defineProperties(note("target", {}), Object.getOwnPropertyDescriptors(null)));
attempt("the source is undefined", () => Object.defineProperties({}, Object.getOwnPropertyDescriptors(undefined)));
attempt("the target is no object", () => Object.defineProperties(5, Object.getOwnPropertyDescriptors(note("source", { a: 1 }))));
attempt("neither is an object: the source is refused first", () => Object.defineProperties(undefined, Object.getOwnPropertyDescriptors(null)));
attempt("the target is frozen", () => Object.defineProperties(Object.freeze({ a: 1 }), Object.getOwnPropertyDescriptors({ b: 2 })));
attempt("the target is frozen and nothing changes", () => Object.defineProperties(Object.freeze({ a: 1 }), Object.getOwnPropertyDescriptors(Object.freeze({ a: 1 }))));
attempt("the target takes no new member", () => Object.defineProperties(Object.preventExtensions({ a: 1 }), Object.getOwnPropertyDescriptors({ a: 2, b: 3 })));
attempt("a fixed member of the target", () => Object.defineProperties(Object.defineProperty({}, "a", { value: 1 }), Object.getOwnPropertyDescriptors({ z: 0, a: 2 })));
attempt("the target is an array", () => Object.defineProperties([1, 2, 3], Object.getOwnPropertyDescriptors({ 1: "one", length: 2, name: "n" })));
attempt("the target is a function", () => Object.defineProperties(function f() {}, Object.getOwnPropertyDescriptors({ extra: 1, name: "renamed" })));
const same = { a: 1, get b() { return note("never", 2); } };
attempt("one object is both", () => Object.defineProperties(same, Object.getOwnPropertyDescriptors(same)));

const traps = label => new Proxy({ a: 1, b: 2 }, {
  ownKeys: target => note(label + " ownKeys", Reflect.ownKeys(target)),
  getOwnPropertyDescriptor: (target, key) => note(label + " describe " + String(key), Reflect.getOwnPropertyDescriptor(target, key)),
  defineProperty: (target, key, descriptor) => note(label + " define " + String(key), Reflect.defineProperty(target, key, descriptor)),
  get: (target, key) => note(label + " get " + String(key), target[key]),
});
attempt("the source is a proxy", () => Object.defineProperties({}, Object.getOwnPropertyDescriptors(traps("source"))));
console.log("the target is a proxy", Object.keys(Object.defineProperties(traps("target"), Object.getOwnPropertyDescriptors({ c: 3 }))).join(), "|", log.splice(0).join());
attempt("a proxy is described before the target is refused", () => Object.defineProperties(null, Object.getOwnPropertyDescriptors(traps("source"))));

const descriptors = Object.getOwnPropertyDescriptors({ a: 1, get b() { return 2; } });
descriptors.a.value = 10;
delete descriptors.b;
attempt("descriptors that somebody else holds", () => Object.defineProperties({}, descriptors));
attempt("three arguments", () => Object.defineProperties({}, Object.getOwnPropertyDescriptors({ a: 1 }), note("third", 3)));
attempt("two sources are described: the first counts", () => Object.defineProperties({}, Object.getOwnPropertyDescriptors({ a: 1 }, note("second", { b: 2 }))));
attempt("nothing is described", () => Object.defineProperties({}, Object.getOwnPropertyDescriptors()));
{
  const Object = { defineProperties: (target, map) => ({ mine: globalThis.Object.keys(map).join() }), getOwnPropertyDescriptors: source => source };
  attempt("another Object", () => Object.defineProperties({}, Object.getOwnPropertyDescriptors({ a: 1, b: 2 })));
}

function mix(base, part) {
  return Object.defineProperties({ ...base }, Object.getOwnPropertyDescriptors(part));
}
const parts = [{ name: "a", run: () => 1 }, { name: "b", run: () => 2, get size() { return this.name.length + 1; } }, { name: "c", run() { return this.name; }, extra: true, enabled: () => false }];
const mixed = parts.map(part => mix({ enabled: () => true, size: 0 }, part));
let sum = 0;
for (let turn = 0; turn < 500; turn++) for (const one of mixed) sum += one.size + (one.enabled() ? 1 : 0) + String(one.run()).length + one.name.length;
console.log("through a function, many times", sum, mixed.map(describe).join(" / "));
parts[0].name = "changed";
console.log("the copy stands by itself", mixed[0].name);
