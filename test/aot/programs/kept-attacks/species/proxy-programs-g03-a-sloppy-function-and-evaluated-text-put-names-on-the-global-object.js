// Species: proxy programs  a sloppy function and evaluated text put names on the global object. It prints what plain Bun prints.
const log = [];
function sloppy() { this.__fromThis = 1; __implicit = "made by a store to a free name"; }
sloppy();
log.push(typeof globalThis.__fromThis, typeof globalThis.__implicit);
(0, eval)("var __evaluated = { deep: 1 }; globalThis.__stored = 'by text';");
log.push(typeof globalThis.__evaluated, typeof globalThis.__stored, String(globalThis.__evaluated.deep));
new Function("globalThis.__byFunction = 7")();
log.push(typeof globalThis.__byFunction);
console.log(log.join("; "));
module.exports = {};
