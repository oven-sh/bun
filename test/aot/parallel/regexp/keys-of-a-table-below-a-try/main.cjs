// tailwindcss makes a pattern of the keys of a table of functions. Required inside a `try`, as an optional dependency is, the file stopped the compiler.
let loaded;
try {
  loaded = require("./table.cjs");
} catch (error) {
  console.log("threw", error.message);
}
console.log(String(loaded.pattern), String(loaded.plain), loaded.pattern.test("theme("), loaded.pattern.test("theme"));
