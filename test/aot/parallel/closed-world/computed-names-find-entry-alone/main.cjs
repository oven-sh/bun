// Of the program's own files a name that is computed at run time finds the entry points and no other, as in an executable that `bun build --compile` makes without --aot.
// A file that another file names by a constant is compiled in, and the compiler counts on it that nobody else gets hold of what the file exports. It has run here, so the loader has it in its cache: the name is refused all the same.
// Text that is decoded at run time is unknown to the compiler.
const decoded = text => Buffer.from(text).toString();
const inside = require("./inside.cjs");
const os = require("node:os");
function outcome(error) {
  const message = String(error.message);
  return message.includes("this executable can't load a module from a dynamic path") ? "refused" : "throws " + error.name + ": " + message;
}
function attempt(label, action) {
  try {
    console.log(label + ": " + action());
  } catch (error) {
    console.log(label + ": " + outcome(error));
  }
}
attempt("the file by its constant name", () => inside.where);
attempt("the file by a computed name", () => require(decoded("./inside.cjs")).where);
attempt("the file through module.require", () => module.require(decoded("./inside.cjs")).where);
attempt("the entry point by a computed name", () => require(decoded("./main.cjs")) === module.exports);
attempt("a built-in module that the program names", () => require(decoded("node:os")) === os);
import(decoded("./inside.cjs")).then(
  namespace => console.log("the file by a computed import: " + namespace.default.where),
  error => console.log("the file by a computed import: " + outcome(error)),
);
/* Output:
the file by its constant name: inside
the file by a computed name: refused
the file through module.require: refused
the entry point by a computed name: true
a built-in module that the program names: true
the file by a computed import: refused
*/
