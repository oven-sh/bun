// The program calls functions that are made from text at run time: with as many arguments as they declare, fewer, more, none; first calls and later ones; functions of every kind.
const vm = require("node:vm");

function callWith(f, ...rest) {
  switch (rest.length) {
    case 0: return f();
    case 1: return f(rest[0]);
    case 2: return f(rest[0], rest[1]);
    case 3: return f(rest[0], rest[1], rest[2]);
    case 6: return f(rest[0], rest[1], rest[2], rest[3], rest[4], rest[5]);
    default: return f(...rest);
  }
}

const describe = new Function("a", "b", "c", "return [arguments.length, a, b, c, typeof this].join('|');");
for (let round = 0; round < 3; round++) {
  console.log(callWith(describe), callWith(describe, 1), callWith(describe, 1, 2), callWith(describe, 1, 2, 3));
  console.log(callWith(describe, 1, 2, 3, 4, 5, 6), callWith(describe, 1, 2, 3, 4, 5, 6, 7, 8, 9));
}

const strict = new Function("'use strict'; return this === undefined ? 'no this' : typeof this;");
const holder = { strict, describe, name: "holder" };
console.log(strict(), holder.strict(), holder.describe(7), strict.call(5), describe.call("text", 1));

let sum = 0;
const add = new Function("x", "y", "return x + y;");
for (let i = 0; i < 2000; i++) sum = add(sum, i);
console.log(sum);

const many = [];
for (let i = 0; i < 40; i++) many.push(new Function("x", `return x * ${i};`));
console.log(many.map((f) => f(2)).join(" "));
console.log(many.map((f, i) => callWith(f, i)).reduce((a, b) => a + b, 0));

const Class = new Function("return class Point { constructor(x) { this.x = x; } static make(x) { return new Point(x); } get double() { return this.x * 2; } };")();
try { callWith(Class, 1); } catch (error) { console.log(error instanceof TypeError, error.constructor.name); }
console.log(new Class(4).double, callWith(Class.make, 5).x);

const generator = new Function("return function* (n) { for (let i = 0; i < n; i++) yield i * i; };")();
console.log([...callWith(generator, 5)].join(" "));
const arrow = new Function("return (a, b = 10) => a + b;")();
console.log(callWith(arrow, 1), callWith(arrow, 1, 2), callWith(arrow));
const rest = new Function("first", "...others", "return first + ':' + others.join(',');");
console.log(callWith(rest), callWith(rest, 1), callWith(rest, 1, 2, 3), callWith(rest, 1, 2, 3, 4, 5, 6, 7));
const bound = describe.bind({ bound: true }, "first");
console.log(callWith(bound), callWith(bound, 2, 3), callWith(bound, 2, 3, 4, 5, 6, 7));

const thrower = new Function("value", "throw new RangeError('thrown ' + value);");
for (let i = 0; i < 3; i++) {
  try { callWith(thrower, i); } catch (error) { console.log(error.message, error instanceof RangeError); }
}
const recursive = new Function("self", "callback", "n", "return n ? callback(self, callback, n - 1) + 1 : 0;");
function comeBack(self, callback, n) { return self(self, callback, n); }
console.log(recursive(recursive, comeBack, 200));
function overflow(f) { try { return f(f); } catch (error) { return error instanceof RangeError; } }
console.log(overflow(new Function("f", "return f(f);")));

const other = vm.runInNewContext("(function (a, b) { return [arguments.length, a, b, this === undefined].join('|'); })");
console.log(callWith(other), callWith(other, 1), callWith(other, 1, 2, 3));
const asynchronous = new Function("return async function (x) { return (await x) + 1; };")();
callWith(asynchronous, 41).then((value) => console.log(value));
for (const notCallable of [undefined, null, 1, "text", {}, Symbol.iterator]) {
  try { callWith(notCallable, 1); } catch (error) { console.log(error instanceof TypeError); }
}
