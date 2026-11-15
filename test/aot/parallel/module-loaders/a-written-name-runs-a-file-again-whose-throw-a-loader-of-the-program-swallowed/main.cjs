// A DECLARED LIMIT. docs/compiler/compatibility.mdx, on a CommonJS file that throws while it loads:
// "That also holds where a loader that your program stored in `Module._extensions` catches the error and goes on: a later `require("./file.js")` with the path written out runs the file again from the top, where `bun run` returns what the file had exported before it threw."
// Under `bun run` the file runs once and the line reads `written {"part":1}`; an executable built with --no-aot prints what stands below. The expected output is written down, so that a change of the answer is seen.
const Module = require("node:module");
const original = Module._extensions[".js"];
let last;
Module._extensions[".js"] = function (module, filename) {
  last = filename.endsWith("late.js") ? new Module(filename) : module;
  try { original(last, filename); } catch (error) { console.log("caught", error.message); original(last, filename); }
  if (last !== module) module.exports = last.exports;
};
const made = (word) => "./" + JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? JSON.stringify(word)) + ".js";
const ask = (how, load) => { try { console.log(how, JSON.stringify(load())); } catch (error) { console.log(how, "threw", error.name); } };
ask("made", () => require(made("subject")));
ask("written", () => require("./subject.js"));
ask("made again", () => require(made("subject")));
ask("late", () => require(made("late")));
console.log("late is frozen", Object.isFrozen(last.exports));
if (process.argv.length > 99) require("./late.js");
/* Output:
subject runs 1
caught made up
made {"part":1}
subject runs 2
written {"part":1,"whole":2}
made again {"part":1}
caught made up too
late {}
late is frozen false
*/
