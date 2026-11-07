// The file throws into the first object that the loader of the program hands on. The loader makes a second one, and the file runs again: that one is its `module` then.
const Module = require("node:module");
const original = Module._extensions[".js"];
Module._extensions[".js"] = function (module, filename) {
  for (let turn = 0; turn < 2; turn++) {
    const other = new Module(filename, module);
    other.turn = turn;
    try {
      original(other, filename);
      module.exports = {
        turn,
        holds: typeof Object.getOwnPropertyDescriptor(other, "exports").get,
        answer: other.exports,
      };
      return;
    } catch (error) {
      console.log("caught", error.message);
    }
  }
};
try {
  console.log(JSON.stringify(require("./" + JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? '"subject"') + ".js")));
} catch (error) {
  console.log("threw", error.message);
}
if (process.argv.length > 99) require("./subject.js");
