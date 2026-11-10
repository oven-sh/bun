"use strict";
const box = { kept: 1, mark: 0 };
Object.defineProperty(box, "mark", { value: true });
let count = 0;
function lay(target, descriptor) { Object.defineProperty(target, "kept", descriptor); }
function sum(target, n) { let s = 0; for (let i = 0; i < n; i++) s += target.kept; return s; }
console.log(sum(box, 30));
lay(box, { get() { return ++count; }, configurable: true });
console.log(sum(box, 30), count, box.mark);
