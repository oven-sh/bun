const part = require("./part.cjs");
function own() {}
function run(made, text) { try { return made.constructor("const child = process.mainModule.children[0]; " + text)(); } catch (error) { return error.name + ": " + error.message.slice(0, 34); } }
function later() { return require("./part.cjs").add(1); }
console.log(typeof require.main, part.add(1));
console.log(run(own, "child.exports.add = function (x) { return x + 100; }; return 1;"), part.add(1), later());
console.log(run(own, "child.exports = {}; return 1;"), part.add(1), later());
console.log(run(own, "return delete child.exports;"), part.add(1), later());
console.log(run(own, "Object.defineProperty(child, 'exports', { value: {} }); return 1;"), part.add(1), later());
console.log(run(own, "return typeof Object.getOwnPropertyDescriptor(child, 'exports');"), part.add(1), later());
console.log(run(own, "return Object.keys(child).length;"), part.add(1), later());
console.log(run(own, "return child.id.length > 0;"), part.add(1), later());
console.log(run(own, "return Bun.inspect(child).length > 0;"), part.add(1), later());
// DECLARED: docs/compiler/compatibility.mdx, "Code from strings": the program only tests require.main, so part.cjs is compiled into the code that requires it and has no module object. bun run prints "object 2" and "1 101 101", and ends at the next line with a TypeError, because the code has replaced the exports.
/* Output:
object 2
Error: Cannot access the module object of 2 2
Error: Cannot access the module object of 2 2
Error: Cannot access the module object of 2 2
Error: Cannot access the module object of 2 2
Error: Cannot access the module object of 2 2
Error: Cannot access the module object of 2 2
Error: Cannot access the module object of 2 2
Error: Cannot access the module object of 2 2
*/
