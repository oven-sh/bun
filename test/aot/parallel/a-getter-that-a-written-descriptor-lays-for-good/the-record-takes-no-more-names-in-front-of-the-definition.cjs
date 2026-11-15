"use strict";
function add(a, b) { return (a + b) | 0; }
function sub(a, b) { return (a - b) | 0; }
const lib = { base: 1 };
Object.preventExtensions(lib);
function lay() { try { Object.defineProperty(lib, "add", { enumerable: true, get: function () { return add; } }); return "laid"; } catch (error) { return error.constructor.name; } }
function call() { try { return lib.add(1, 2); } catch (error) { return error.constructor.name; } }
console.log(lay(), call(), typeof lib.add);
