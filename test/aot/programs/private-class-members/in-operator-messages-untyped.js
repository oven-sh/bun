// `#name in value` where the value is not an object: a static method or accessor has a message of its own, every other private name has the message of the `in` operator, which describes the value (the same program without type annotations).
function said(f) { try { return String(f()); } catch (e) { return e.name + ": " + e.message; } }
function row(label, f) { console.log(label + ": " + said(f)); }

class C {
  static #field = 1;
  static #blank;
  static #method() {}
  static get #getter() { return 1; }
  static set #setter(v) {}
  static get #both() { return 1; }
  static set #both(v) {}
  #instance = 1;
  #instanceMethod() {}
  get #instanceGetter() { return 1; }
  static hasField(v) { return #field in v; }
  static hasBlank(v) { return #blank in v; }
  static hasMethod(v) { return #method in v; }
  static hasGetter(v) { return #getter in v; }
  static hasSetter(v) { return #setter in v; }
  static hasBoth(v) { return #both in v; }
  static hasInstance(v) { return #instance in v; }
  static hasInstanceMethod(v) { return #instanceMethod in v; }
  static hasInstanceGetter(v) { return #instanceGetter in v; }
  static callMethod(v) { return v.#method(); }
  static readGetter(v) { return v.#getter; }
}
const asks = ["hasField", "hasBlank", "hasMethod", "hasGetter", "hasSetter", "hasBoth", "hasInstance", "hasInstanceMethod", "hasInstanceGetter"];
const values = [["a number", 1], ["zero", 0], ["NaN", NaN], ["a string", "s"], ["the empty string", ""], ["null", null], ["undefined", undefined], ["true", true], ["false", false], ["a symbol", Symbol("described")], ["a bigint", 1n],
  ["the class", C], ["an instance", new C()], ["an object", {}], ["a function", () => 1], ["a proxy of the class", new Proxy(C, {})]];
for (const ask of asks) for (const [name, v] of values) row(ask + " of " + name, () => C[ask](v));
// An access is not a test: it has the message of the admission, for an object and for what is none.
for (const [name, v] of values) {
  row("callMethod of " + name, () => C.callMethod(v));
  row("readGetter of " + name, () => C.readGetter(v));
}
