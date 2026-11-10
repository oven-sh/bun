import * as space from "./barrel.mjs";
const plain = { other: 1 };
function make() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return { inner: { v: 1 + work }, m: work }; }
function poke(n, r) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; try { return n.taint(r); } catch (e) { return 0; } }
function deep(r) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; try { return r.inner.v; } catch (e) { return e.name; } }
let out = "";
for (let i = 0; i < 300; i++) { const rec = make(); poke(i & 1 ? space : plain, rec); out = String(deep(rec)); }
console.log(out);
