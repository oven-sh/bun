// In a file of CommonJS, which is sloppy, a function whose body begins with "use strict" is as sloppy as the file: plain Bun drops the directive of a function when it transpiles, and --aot does what plain Bun does. The stored output is that of plain Bun; run-aot-matches-executable.test.ts reads it.
function sloppy() { return typeof this; }
function strict() { "use strict"; return typeof this; }
const parameters = function (a, b) { "use strict"; a = "A"; arguments[1] = "B"; return [a, b, arguments[0], arguments[1]].join(); };
const sloppyParameters = function (a, b) { a = "A"; arguments[1] = "B"; return [a, b, arguments[0], arguments[1]].join(); };
const arrow = () => { "use strict"; try { undeclaredByAnyone = 1; return "stored"; } catch (e) { return e.name; } };
const object = { method() { 'use strict'; return typeof this; }, get getter() { "use strict"; return typeof this; } };
function outer() { "use strict"; return function () { return typeof this; }; }
function notFirst() { 1; "use strict"; return typeof this; }
function behindAnother() { "use client"; "use strict"; return typeof this; }
function frozen() { "use strict"; try { Object.freeze({ a: 1 }).a = 2; return "stored"; } catch (e) { return e.name; } }
function sloppyFrozen() { try { Object.freeze({ a: 1 }).a = 2; return "no error"; } catch (e) { return e.name; } }
function deletes() { "use strict"; try { return delete Object.freeze({ a: 1 }).a; } catch (e) { return e.name; } }
function* generator() { "use strict"; yield typeof this; }
async function later() { "use strict"; return typeof this; }
console.log("this of a sloppy function:", sloppy.call(5), "| of a strict one:", strict.call(5), "| called plainly:", strict());
console.log("parameters and arguments:", parameters(1, 2), "| sloppy:", sloppyParameters(1, 2));
console.log("a store to a name that nobody declares:", arrow());
console.log("a method:", object.method.call(5), "| a getter:", Object.getOwnPropertyDescriptor(object, "getter").get.call(5));
console.log("a function within:", outer().call(5), outer()());
console.log("not the first statement:", notFirst.call(5), "| behind another directive:", behindAnother.call(5));
console.log("a store to a frozen object:", frozen(), "| sloppy:", sloppyFrozen(), "| a delete:", deletes());
console.log("a generator:", generator.call(5).next().value);
later.call(5).then(said => console.log("an async function:", said));
let hot = 0;
for (let i = 0; i < 100000; i++) if (strict.call(i) === "number" && sloppy.call(i) === "object") hot++;
console.log("a hundred thousand times:", hot);
module.exports = { strict };
