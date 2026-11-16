import * as space from "./barrel.mjs";
function readLevel(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return n.level; }
function readDepth(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return n.depth; }
let text = "";
for (let i = 0; i < 300; i++) text = typeof readLevel(space) + " " + (readDepth(space) + 1);
console.log(text);
