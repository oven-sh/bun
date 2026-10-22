// The members of a module object, of `require` and of node:module that the host makes or keeps up with functions of the library: a program that only stores to them reads none of them,
// and the files that it loads afterwards are linked to their parents as always.
const print = console.log;
function attempt(label, action) {
  try { print(label + ": " + action()); } catch (error) { print(label + ": " + error.name + (error.code ? " " + error.code : "") + ": " + error.message.slice(0, 60)); }
}
attempt("module.children", () => { module.children = []; return "stored"; });
attempt("module.parent", () => { module.parent = null; return "stored"; });
attempt("a file loaded behind the stores", () => require("./inner.cjs").answer);
attempt("process.mainModule", () => { process.mainModule = "mine"; return "stored"; });
attempt("console.Console", () => { console.Console = "mine"; return "stored"; });
attempt("another file", () => require("./other.cjs").answer);
