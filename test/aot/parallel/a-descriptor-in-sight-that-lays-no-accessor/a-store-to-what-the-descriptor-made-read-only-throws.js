"use strict";
const box = { kept: 1, mark: 0 };
Object.defineProperty(box, "mark", { value: 7, writable: false });
function put(target, n) { let failed = 0; for (let i = 0; i < n; i++) { try { target.mark = i; } catch (error) { failed++; } target.kept = i; } return failed; }
console.log(put(box, 30), box.mark, box.kept, Object.keys(box).join());
