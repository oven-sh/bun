"use strict";
function add(a, b) { return (a + b) | 0; }
const lib = {};
function look() { return typeof lib.add; }
function call() { try { return lib.add(1, 2); } catch (error) { return error.constructor.name; } }
const early = look() + " " + call();
Object.defineProperty(lib, "add", { enumerable: true, get: function () { return add; } });
console.log(early, look(), call());
