"use strict";
const box = { kept: 1, mark: 0 };
function sum(target, n) { let s = 0; for (let i = 0; i < n; i++) s += target.mark + target.kept; return s; }
console.log(sum(box, 30));
Object.defineProperty(box, "mark", { value: 2.5 });
console.log(sum(box, 30));
Object.defineProperty(box, "mark", { value: "x", writable: true });
console.log(sum(box, 3));
