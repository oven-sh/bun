"use strict";
function add(a, b) { return (a + b) | 0; }
function sub(a, b) { return (a - b) | 0; }
const lib = { base: 1 };
function early() { try { return lib.add(1, 2); } catch (error) { return error.constructor.name; } }
const before = typeof lib.add + " " + early();
Object.defineProperties(lib, { add: { enumerable: true, get: function () { return add; } } });
console.log(before, early());
