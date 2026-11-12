"use strict";
const box = { kept: 1, mark: 0 };
Object.defineProperty(box, "mark", { value: true });
let count = 0;
function sum(target, n) { let s = 0; for (let i = 0; i < n; i++) s += target.kept; return s; }
console.log(sum(box, 30));
Object.defineProperty(box, "kept", { get: function () { return ++count; } });
console.log(sum(box, 30), count, box.mark);
