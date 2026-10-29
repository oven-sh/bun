// RUN: lower
// OPTIONS: builtin-modules

// The same store hits an object of the program under a symbol that the program also spells out.
var few = process.argv.length < 100;
var tag = Symbol("tag");
var keys = [tag, Symbol.toPrimitive];
var key = keys[few ? 0 : 1];
var own = { [tag]: 1, plain: 2 };
var receiver = few ? own : globalThis;
receiver[key] = 5;
console.log(own[tag], own.plain, typeof process.pid);
var second = keys[few ? 1 : 0];
receiver[second] = function () { return 9; };
console.log(own + 1);
