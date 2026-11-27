"use strict";
const box = { kept: 1, mark: 0 };
let count = 0;
const half = { get: function () { return ++count; } };
function sum(target, n) { let s = 0; for (let i = 0; i < n; i++) s += target.kept; return s; }
console.log(sum(box, 30));
Object.defineProperty(box, "kept", { ...half, enumerable: true });
console.log(sum(box, 30), count);
