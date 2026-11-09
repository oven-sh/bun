// asker.cjs runs because root.mjs imports it, and requires asked.mjs, which root.mjs imports next and which imports asker.cjs back. The loader runs the body of root.mjs inside that require.
// Four ways to write the load, each with files of its own: a written default, a list mapped by require, require kept in an object, a path in a field of a class.
const said = (globalThis.said = []);
said.push("default");
require("./default/root.mjs");
said.push("list");
require("./list/root.mjs");
said.push("object");
require("./object/root.mjs");
said.push("field");
require("./field/root.mjs");
setTimeout(() => console.log(said.join(" ")), 30);
