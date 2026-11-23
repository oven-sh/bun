"use strict";
function add(a, b) { return (a + b) | 0; }
function sub(a, b) { return (a - b) | 0; }
const lib = { base: 1 };
function lay() { try { Object.defineProperties(lib, { add: { writable: true, get: function () { return add; } } }); return "laid"; } catch (error) { return error.constructor.name; } }
console.log(lay(), typeof lib.add);
