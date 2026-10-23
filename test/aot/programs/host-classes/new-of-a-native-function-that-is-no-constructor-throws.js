const { types } = require("node:util");
const { isAscii, resolveObjectURL } = require("node:buffer");
const { heapSize } = require("bun:jsc");
function attempt(label, make) {
  try {
    console.log(label, "answers", typeof make());
  } catch (error) {
    console.log(label, "throws", error.name, error instanceof TypeError);
  }
}
attempt("types.isDate", () => new types.isDate(new Date(0)));
attempt("types.isMap", () => new types.isMap(new Date(0)));
attempt("isAscii", () => new isAscii(Buffer.from("a")));
attempt("heapSize", () => new heapSize());
attempt("resolveObjectURL", () => new resolveObjectURL("blob:nodedata:none"));
attempt("Reflect.construct", () => Reflect.construct(heapSize, []));
attempt("a subclass", () => new (class extends heapSize {})());
console.log(types.isDate(new Date(0)), types.isMap(new Date(0)), isAscii(Buffer.from("a")), typeof heapSize(), resolveObjectURL("blob:nodedata:none"));
