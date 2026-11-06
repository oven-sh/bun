// require() and require.resolve() reject a specifier that is not a string as it is: they never call its toString or valueOf.
const calls = [];
const specifier = {
  toString() {
    calls.push("toString");
    return "node:path";
  },
  valueOf() {
    calls.push("valueOf");
    return "node:path";
  },
  [Symbol.toPrimitive]() {
    calls.push("toPrimitive");
    return "node:path";
  },
};
function attempt(name, load) {
  for (const value of [specifier, ["node:path"], 5, null, undefined, true, Symbol("node:path")]) {
    try {
      console.log(name, typeof load(value));
    } catch (error) {
      console.log(name, error.name, error.code);
    }
  }
}
attempt("require", value => require(value));
attempt("resolve", value => require.resolve(value));
attempt("module.require", value => module.require(value));
console.log(calls.length);
console.log(require("node:path").sep === require(String(specifier)).sep, calls.join());
