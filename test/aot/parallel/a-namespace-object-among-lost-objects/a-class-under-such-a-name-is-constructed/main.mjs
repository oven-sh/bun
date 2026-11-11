import * as space from "./barrel.mjs";
const plain = { other: 1 };
function build(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; try { return new n.Maker(); } catch (e) { return null; } }
function kind(v) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return v === null ? "null" : typeof v.tag; }
let out = "";
for (let i = 0; i < 300; i++) out = kind(build(i & 1 ? space : plain));
console.log(out);
