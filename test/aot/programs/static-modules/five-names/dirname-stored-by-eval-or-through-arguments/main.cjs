// The body of a CommonJS file is a sloppy function: a direct eval and its `arguments` store to `__dirname` too, and a specifier that is
// built from it is then a computed name, which finds entry points alone.
require("./a.js"), require("./other/a.js");
const row = (name, load) => {
  try {
    console.log(name, load());
  } catch (error) {
    console.log(name, "throws", error.code);
  }
};
row("eval", () => require("./by-eval.cjs"));
row("arguments", () => require("./by-arguments.cjs"));
