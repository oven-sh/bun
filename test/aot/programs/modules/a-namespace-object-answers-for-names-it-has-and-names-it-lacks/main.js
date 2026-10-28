// Reads of a namespace object by constant names: a constant, a name that no file exports, a name that two `export *` give two meanings, and what is no read.
import * as all from "./barrel.js";
import * as values from "./values.js";
function attempt(name, run) {
  try {
    console.log(name, run());
  } catch (error) {
    console.log(name, error.constructor.name);
  }
}
console.log(values.a, values["b"], values.a + values.b, typeof values.absent, values.then, values.toString, values.__proto__, values.default);
console.log(all.a, all.own, typeof all.twice, "twice" in all, all.same, all.default, Object.keys(all));
attempt("store", () => Reflect.set(values, "a", 5));
attempt("store to a name that is not there", () => Reflect.set(values, "absent", 5));
attempt("delete", () => Reflect.deleteProperty(values, "a"));
attempt("delete a name that is not there", () => Reflect.deleteProperty(values, "absent"));
// @ts-ignore
attempt("call", () => values.a());
attempt("in", () => "a" in values);
console.log(values.a, Object.keys(values), Object.getOwnPropertyDescriptor(values, "a"));
