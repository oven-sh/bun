// The loader of the program makes a module object of its own and hands that one to the default loader. It is the file's `module`, as in `bun run`:
// the file reads what was laid on it, `this` and `exports` are its `exports`, what the file requires is its child, and a getter that the file defines lies on it.
// The executable ran the file with the object that require() had made.
const Module = require("node:module");
const original = Module._extensions[".js"];
const show = (name, it) =>
  console.log(
    name,
    JSON.stringify(it.exports),
    typeof Object.getOwnPropertyDescriptor(it, "exports")?.get,
    it.loaded,
    it.children.length,
  );
Module._extensions[".js"] = function (module, filename) {
  const other = new Module(filename, module);
  module.laid = "on the object of require()";
  other.laid = "on the other";
  original(other, filename);
  show("the other", other);
  show("the object of require()", module);
  module.exports = { through: other.exports };
};
if (process.argv.length > 99) require("./subject.js");
console.log(JSON.stringify(require("./" + JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? '"subject"') + ".js")));
