// Text is handed a require that createRequire() made, and calls the loaders in its `extensions` by hand on a file of the program that is no entry point.
// In plain Bun each loader of code reads the file from disk and runs it once more. In an executable no second copy of the file runs: each says that the file isn't in the executable ("absent").
// The loader of .json reads the text as data, here as there.
const { createRequire } = require("node:module");
const inner = require("./inner.cjs");
globalThis.made = createRequire(__filename);
globalThis.found = [];
new Function(Buffer.from(`
  const Module = made("node:module"), path = made.resolve("./inner.cjs");
  const refusals = { "it isn't in this executable": "absent", "can't be loaded a second time": "no second time" };
  const attempt = (road, prepare) => {
    const own = new Module("own");
    try {
      prepare(own);
      found.push(road + " " + typeof own.exports.count);
    } catch (error) {
      const known = Object.keys(refusals).find(part => error.message.includes(part));
      found.push(road + " " + (known ? refusals[known] : error.name + " " + error.message.split(path).join("<>").slice(0, 44)));
    }
  };
  attempt(".json", own => made.extensions[".json"](own, path));
  attempt(".ts", own => made.extensions[".ts"](own, path));
  attempt("_compile", own => { own._compile = () => {}; made.extensions[".js"](own, path); });
  attempt(".js", own => made.extensions[".js"](own, path));
`).toString())();
console.log(found.join(" | "));
console.log("the program goes on:", inner.count(1), inner.count(2));
/* Output:
.json SyntaxError JSON Parse error: Unexpected identifier "let | .ts absent | _compile absent | .js absent
the program goes on: 1 3
*/
