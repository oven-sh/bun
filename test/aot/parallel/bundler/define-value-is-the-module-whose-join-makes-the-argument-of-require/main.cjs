// A `--define` whose value names the variable that holds `node:path` joins the folder of the file and a name into the argument of `require`: the build finds the files that the name may stand for.
// Flags: --define PATH=path
const path = require("path");
const name = Date.now() > 0 ? "a" : "b";
console.log(require(PATH.join(__dirname, "lib", name + ".js")).name);
