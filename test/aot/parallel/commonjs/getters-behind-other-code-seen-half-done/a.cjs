"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
console.log(globalThis.hook("in front of the definitions"));
Object.defineProperty(exports, "f", { enumerable: true, get: function() { return f; } });
console.log(globalThis.hook("between the definitions"));
Object.defineProperty(exports, "x", { enumerable: true, get: function() { return x; } });
console.log(globalThis.hook("behind the definitions"));
const x = 1;
function f() { return "f"; }
