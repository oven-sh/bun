// docs/compiler/compatibility.mdx, "Loader hooks and the module cache": a module runs once.
// Under `bun run` the file runs twice, once into each object. The executable holds the file once, compiled, and refuses the second call aloud, whichever object comes second.
// It used to lay the exports of the one run on the object of require() without a word. The expected output is written down.
const Module = require("node:module");
const original = Module._extensions[".js"];
Module._extensions[".js"] = function (module, filename) {
  const other = new Module(filename, module);
  module.laid = "on the object of require()";
  other.laid = "on the other";
  const order = filename.includes("other-first") ? [other, module] : [module, other];
  for (const handed of order) {
    try {
      original(handed, filename);
    } catch (error) {
      console.log(error.message.replace(/'.*?'/, "<path>").split(":")[0]);
    }
  }
  console.log(JSON.stringify(other.exports), other.loaded, JSON.stringify(module.exports), module.loaded);
};
if (process.argv.length > 99) {
  require("./other-first.js");
  require("./own-first.js");
}
for (const word of ["other", "own"])
  require("./" + JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? JSON.stringify(word)) + "-first.js");
/* Output:
runs
Cannot run <path> a second time
{"laid":"on the other"} true {} false
runs
Cannot run <path> a second time
{} false {"laid":"on the object of require()"} true
*/
