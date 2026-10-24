import * as self from "./everything-is-asked-of-a-module-namespace-object.mjs";
export var width = 30;
export let height = 40;
export function area() { return width * height; }
export const label = "box";
export default 7;

function tell(name, ask) {
  let text;
  try {
    const answer = ask();
    text = typeof answer === "string" ? answer : JSON.stringify(answer, (key, value) => (typeof value === "symbol" ? String(value) : typeof value === "function" ? "function " + value.name : value));
  } catch (error) {
    text = "throws " + error.name;
  }
  console.log(name + ": " + text);
}

for (let round = 0; round < 3; round++) {
  tell("by name", () => [self.width, self.height, self.label, self.default, self.area(), self.missing]);
  tell("by key", () => ["width", "label", "missing", Symbol.toStringTag].map(key => String(self[key])));
  tell("in", () => ["width" in self, "missing" in self, Symbol.toStringTag in self, Symbol.iterator in self]);
  tell("hasOwn", () => [Object.hasOwn(self, "width"), Object.hasOwn(self, "missing"), Object.hasOwn(self, Symbol.toStringTag)]);
  tell("hasOwnProperty", () => [Object.prototype.hasOwnProperty.call(self, "width"), Object.prototype.hasOwnProperty.call(self, "missing")]);
  tell("propertyIsEnumerable", () => [Object.prototype.propertyIsEnumerable.call(self, "width"), Object.prototype.propertyIsEnumerable.call(self, Symbol.toStringTag)]);
  tell("keys", () => Object.keys(self));
  tell("values", () => Object.values(self));
  tell("entries", () => Object.entries(self));
  tell("names", () => Object.getOwnPropertyNames(self));
  tell("symbols", () => Object.getOwnPropertySymbols(self).map(String));
  tell("ownKeys", () => Reflect.ownKeys(self).map(String));
  tell("ownKeys joined", () => Reflect.ownKeys(self).map(String).join());
  tell("descriptor", () => [Object.getOwnPropertyDescriptor(self, "width"), Object.getOwnPropertyDescriptor(self, Symbol.toStringTag), Object.getOwnPropertyDescriptor(self, "missing")]);
  tell("descriptors", () => Object.keys(Object.getOwnPropertyDescriptors(self)));
  tell("spread", () => ({ ...self }));
  tell("rest", () => { const { width: taken, ...rest } = self; return [taken, rest]; });
  tell("assign", () => Object.assign({}, self));
  tell("assign onto", () => Object.assign(self, {}) === self);
  tell("assign a name onto", () => Object.assign(self, { width: 1 }));
  tell("fromEntries", () => Object.fromEntries(Object.entries(self)));
  tell("stringify", () => JSON.stringify(self));
  tell("for in", () => { const seen = []; for (const key in self) seen.push(key, typeof self[key]); return seen; });
  tell("clone", () => structuredClone(self));
  tell("isFrozen", () => [Object.isFrozen(self), Object.isSealed(self), Object.isExtensible(self)]);
  tell("freeze", () => Object.freeze(self) === self);
  tell("seal", () => Object.seal(self) === self);
  tell("preventExtensions", () => Object.preventExtensions(self) === self);
  tell("isFrozen again", () => [Object.isFrozen(self), Object.isSealed(self), Object.isExtensible(self)]);
  tell("prototype", () => [Object.getPrototypeOf(self), Reflect.getPrototypeOf(self), self instanceof Object]);
  tell("setPrototypeOf null", () => Object.setPrototypeOf(self, null) === self);
  tell("setPrototypeOf", () => Object.setPrototypeOf(self, {}));
  tell("Reflect.setPrototypeOf", () => [Reflect.setPrototypeOf(self, null), Reflect.setPrototypeOf(self, {})]);
  tell("toString", () => Object.prototype.toString.call(self));
  tell("tag", () => self[Symbol.toStringTag]);
  tell("String", () => String(self));
  tell("template", () => `${self}`);
  tell("plus", () => self + "");
  tell("store", () => { self.width = 1; return self.width; });
  tell("store a new name", () => { self.depth = 1; return self.depth; });
  tell("store by key", () => { self["hei" + "ght"] = 1; return self.height; });
  tell("delete", () => delete self.width);
  tell("delete a missing name", () => delete self.missing);
  tell("Reflect.set", () => [Reflect.set(self, "width", 1), Reflect.set(self, "depth", 1), self.width]);
  tell("Reflect.get", () => [Reflect.get(self, "width"), Reflect.get(self, "missing")]);
  tell("Reflect.has", () => [Reflect.has(self, "width"), Reflect.has(self, "missing")]);
  tell("Reflect.deleteProperty", () => [Reflect.deleteProperty(self, "width"), Reflect.deleteProperty(self, "missing")]);
  tell("Reflect.defineProperty", () => [Reflect.defineProperty(self, "width", { value: 30 }), Reflect.defineProperty(self, "width", { value: 31 }), Reflect.defineProperty(self, "depth", { value: 1 })]);
  tell("defineProperty", () => Object.defineProperty(self, "depth", { value: 1 }));
  tell("Reflect.isExtensible", () => [Reflect.isExtensible(self), Reflect.preventExtensions(self)]);
  tell("typeof", () => [typeof self, Array.isArray(self), self === self, Object.is(self, self), Object(self) === self]);
  tell("weak", () => { const map = new WeakMap([[self, 1]]); const set = new Set([self]); return [map.get(self), set.has(self)]; });
  tell("create", () => { const heir = Object.create(self); return [heir.width, "width" in heir, Object.keys(heir)]; });
  tell("array from", () => [Array.from(self), Array.prototype.slice.call(self), Array.prototype.map.call(self, String)]);
  tell("iterate", () => [...self]);
  tell("call", () => self());
  tell("construct", () => new self());
  tell("groupBy", () => Object.groupBy(Object.keys(self), key => typeof self[key]));
  width += 1;
  height += 1;
}
