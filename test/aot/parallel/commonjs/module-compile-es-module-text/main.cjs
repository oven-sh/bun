// Module.prototype._compile with text that only parses as an ES module. Under a name that no file has the text is
// loaded as that ES module. A file of the executable keeps its name, and the text gets the error of the CommonJS parse.
// Plain Bun holds a file that require() loaded in the require cache only, and loads the text under that name.
const Module = require("node:module");
const path = require("node:path");

const text = ["export const a", "= 1;"].join(" ");
function compile(filename) {
  const m = new Module(filename);
  try {
    m._compile(text, filename);
    return JSON.stringify({ ...m.exports });
  } catch (error) {
    return error.name + ": " + error.message.split("\n")[0];
  }
}

console.log("a name that no file has:", compile(path.join(__dirname, "no-such-file.js")));
console.log("the name of the entry point:", compile(__filename));
console.log("the name of a required CommonJS file:", compile(require("./required.cjs").filename));
import("./imported.cjs").then(imported => {
  console.log("the name of an imported CommonJS file:", compile(imported.default.filename));
});
/* Output:
a name that no file has: {"a":1}
the name of the entry point: SyntaxError: Unexpected keyword 'export'
the name of a required CommonJS file: SyntaxError: Unexpected keyword 'export'
the name of an imported CommonJS file: SyntaxError: Unexpected keyword 'export'
*/
