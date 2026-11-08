import * as space from "./barrel.mjs";
function read(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return n.level; }
let kind = "";
for (let i = 0; i < 300; i++) kind = typeof read(space);
console.log(kind, read(space) === undefined);
