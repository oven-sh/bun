import * as space from "./barrel.mjs";
function read(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return n.level; }
function add(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return read(n) + 1; }
let sum = 0;
for (let i = 0; i < 300; i++) sum = add(space);
console.log(String(sum));
