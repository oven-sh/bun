// The object that loses its prototype comes through a binding, a parameter and a field: it is import.meta all the same.
const held = import.meta;
const box = { inner: held };
function cut(object, above) {
  return Object.setPrototypeOf(object, above);
}
function ask() {
  try {
    return typeof import.meta.resolve("./x.mjs");
  } catch (error) {
    return error.constructor.name + ": " + error.message;
  }
}
console.log(ask());
cut({}, null);
console.log(ask());
cut(box.inner, { inherited: 1 });
console.log(ask(), held.inherited, typeof held.resolve, typeof box.inner.url);
const taken = import.meta.resolve;
try {
  console.log(typeof taken, taken("./x.mjs"));
} catch (error) {
  console.log(error.constructor.name, error.message);
}
