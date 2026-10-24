// What Object.getOwnPropertyDescriptors describes keeps its attributes in the copy: a hidden name stays hidden, a read-only one read-only, an accessor an accessor, and a symbol is copied too.
"use strict";
const tag = Symbol("tag");
const source = { shown: 1, [tag]: "tagged", get twice() { return this.shown * 2; }, set twice(value) { this.shown = value / 2; } };
Object.defineProperty(source, "hidden", { value: 2, enumerable: false, writable: true, configurable: true });
Object.defineProperty(source, "fixed", { value: 3, enumerable: true, writable: false, configurable: false });
const copy = Object.defineProperties({ own: 0 }, Object.getOwnPropertyDescriptors(source));
console.log(Object.keys(copy).join(), JSON.stringify(copy), copy.hidden, copy[tag], copy.twice);
copy.twice = 10;
console.log(copy.shown, copy.twice, source.shown);
try {
  copy.fixed = 4;
} catch (error) {
  console.log(error.constructor.name, copy.fixed);
}
const created = Object.create({ inherited: true }, Object.getOwnPropertyDescriptors(source));
console.log(Object.keys(created).join(), created.inherited, created.hidden, created.twice, Object.getOwnPropertyNames(created).join());
class Base {
  method() {
    return "method of " + this.name;
  }
}
const mixed = Object.defineProperties({ name: "mixed" }, Object.getOwnPropertyDescriptors(Base.prototype));
console.log(mixed.method(), Object.keys(mixed).join(), mixed.constructor === Base);
const descriptors = Object.getOwnPropertyDescriptors({ a: 1, b: 2 });
delete descriptors.a;
descriptors.c = { value: 3, enumerable: true };
descriptors.b.value = 20;
console.log(JSON.stringify(Object.defineProperties({}, descriptors)), descriptors.b.writable);
