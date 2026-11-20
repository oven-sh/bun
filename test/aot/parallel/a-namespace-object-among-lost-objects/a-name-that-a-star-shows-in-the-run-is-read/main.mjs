import * as space from "./barrel.mjs";
const plain = { other: 1 };
function read(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return n.extra; }
function kind(v) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return typeof v; }
let out = "";
for (let i = 0; i < 300; i++) out = kind(read(i & 1 ? space : plain));
console.log(out);
