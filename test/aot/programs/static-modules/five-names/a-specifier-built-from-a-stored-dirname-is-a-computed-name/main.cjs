// `__dirname` and `__filename` are variables. Once the program stores to one, a specifier that is built from it is a computed name, which
// finds entry points alone: the build does not load the file beside this one in its place.
require("./a.js"), require("./other/a.js");
const row = (name, load) => {
  try {
    console.log(name, load());
  } catch (error) {
    console.log(name, "throws", error.code);
  }
};
row("stored", () => require("./stored.cjs"));
row("added", () => require("./added.cjs"));
row("in a function", () => require("./in-a-function.cjs"));
row("filename", () => require("./filename.cjs"));
row("untouched", () => require("./untouched.cjs"));
