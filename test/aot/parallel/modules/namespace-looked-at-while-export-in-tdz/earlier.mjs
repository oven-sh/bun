import * as later from "./later.mjs";

let sealed;
try {
  sealed = Object.isSealed(later);
} catch (error) {
  sealed = "!" + error.constructor.name;
}
let frozen;
try {
  frozen = Object.isFrozen(later);
} catch (error) {
  frozen = "!" + error.constructor.name;
}
console.log(String(sealed), String(frozen), Object.isExtensible(later));

const attempt = (name, look) => {
  let seen;
  try {
    seen = String(look());
  } catch (error) {
    seen = "!" + error.constructor.name;
  }
  console.log(name, seen);
};
attempt("isSealed", () => Object.isSealed(later));
attempt("isFrozen", () => Object.isFrozen(later));
attempt("getOwnPropertyDescriptor", () => Object.getOwnPropertyDescriptor(later, "a"));
attempt("getOwnPropertyDescriptors", () => Object.getOwnPropertyDescriptors(later));
attempt("Reflect.getOwnPropertyDescriptor", () => Reflect.getOwnPropertyDescriptor(later, "a"));
attempt("keys", () => Object.keys(later));
attempt("values", () => Object.values(later));
attempt("entries", () => Object.entries(later));
attempt("getOwnPropertyNames", () => Object.getOwnPropertyNames(later));
attempt("assign", () => Object.keys(Object.assign({}, later)));
attempt("spread", () => Object.keys({ ...later }));
attempt("hasOwnProperty", () => Object.prototype.hasOwnProperty.call(later, "a"));
attempt("hasOwn", () => Object.hasOwn(later, "a"));
attempt("propertyIsEnumerable", () => Object.prototype.propertyIsEnumerable.call(later, "a"));
attempt("Reflect.get", () => Reflect.get(later, "a"));
attempt("Reflect.has", () => Reflect.has(later, "a"));
attempt("in", () => "a" in later);
attempt("stringify", () => JSON.stringify(later));
attempt("for in", () => {
  const names = [];
  for (const name in later) names.push(name);
  return names;
});
attempt("freeze", () => Object.freeze(later));
attempt("seal", () => Object.seal(later) === later);
attempt("read", () => later.a);
attempt("computed", () => later[["a"][0]]);
attempt("Reflect.ownKeys", () => Reflect.ownKeys(later).length);
attempt("toString", () => Object.prototype.toString.call(later));
