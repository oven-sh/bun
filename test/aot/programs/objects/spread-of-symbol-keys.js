// Object literals that spread an object with symbol keys, as libraries do to build prototypes: the copy has the same keys in the same order as in plain Bun.
const tag = Symbol("tag"), other = Symbol.for("other");
const show = o => Reflect.ownKeys(o).map(k => String(k) + "=" + (typeof o[k] === "function" ? "function " + o[k].name : String(o[k]))).join(" ");
const base = { kind: "base", [tag]: 1, pipe() { return "pipe " + this.kind; }, [Symbol.iterator]() { return [this.kind][Symbol.iterator](); }, toJSON() { return { kind: this.kind }; }, [other]: 2, last: 3 };
const extend = options => ({ ...base, kind: options.kind, evaluate: options.evaluate ?? (() => 0), onSuccess: options.onSuccess, onFailure: options.onFailure, [tag]: options.tag });
for (let i = 0; i < 4; i++) {
  const made = extend({ kind: "k" + i, evaluate() { return i; }, tag: i });
  console.log(show(made), "|", made.pipe(), [...made].join(), JSON.stringify(made), made.evaluate());
  const Impl = function (value) { this.value = value; };
  Impl.prototype = made;
  const instance = new Impl(i);
  console.log(instance.kind, instance[tag], instance[other], instance.evaluate(), instance.pipe(), instance.onSuccess, "missing" in instance);
}
console.log("only a copy:", show({ ...base }), "|", show({ ...base, ...{ [tag]: "second" } }));

class Hidden { #secret = 1; shown = 2; [tag] = 3; read() { return this.#secret; } static has(o) { return #secret in o; } }
for (let i = 0; i < 3; i++) {
  const copy = { ...new Hidden(), more: i };
  console.log("private names stay behind:", show(copy), Hidden.has(copy), Hidden.has(new Hidden()));
}

const hidden = { a: 1, [tag]: 2 };
Object.defineProperty(hidden, "unseen", { value: 3, enumerable: false });
Object.defineProperty(hidden, other, { value: 4, enumerable: false });
for (let i = 0; i < 3; i++) console.log("not enumerable:", show({ ...hidden, more: i }));

const computed = { a: 1, [tag]: 2, get b() { return this.a + 10; }, get [other]() { return this.a + 20; } };
for (let i = 0; i < 3; i++) { computed.a = i; console.log("getters are read:", show({ ...computed, more: i })); }

const holes = { a: 1, [tag]: 2, b: 3, c: 4, d: 5, e: 6, f: 7, g: 8 };
delete holes.b;
for (let i = 0; i < 3; i++) console.log("one deleted in the middle:", show({ ...holes, more: i }));
delete holes.g;
for (let i = 0; i < 3; i++) console.log("the last deleted:", show({ ...holes, more: i, evenMore: i }));
holes.g = 9; holes[other] = 10;
for (let i = 0; i < 3; i++) console.log("added again:", show({ ...holes, more: i }));

const frozen = Object.freeze({ a: 1, [tag]: 2 });
for (let i = 0; i < 3; i++) { const copy = { ...frozen, more: i }; copy.a = 5; copy[tag] = 6; console.log("a copy of a frozen object is not frozen:", show(copy), Object.isFrozen(copy)); }

const wide = {}; for (let i = 0; i < 70; i++) wide[i % 7 ? "p" + i : Symbol.for("s" + i)] = i;
for (let i = 0; i < 3; i++) console.log("seventy properties:", Reflect.ownKeys({ ...wide, more: i }).length, show({ ...wide, more: i }).length);
