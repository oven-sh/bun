// Three old objects each get a young one; a collection of the young stands between that and the next stores into the same owners: each first store remembers its owner itself.
import { edenGC, fullGC } from "bun:jsc";
function put(p, q, r) {
  p.a = { v: 1 }; q.a = { v: 2 }; r.a = { v: 3 };
  edenGC();
  p.b = { v: 4 }; q.b = { v: 5 }; r.b = { v: 6 };
}
const p = { a: null, b: null }, q = { a: null, b: null }, r = { a: null, b: null };
fullGC(); put(p, q, r);
const over = []; for (let i = 0; i < 10000; i++) over.push({ v: 9 });
console.log(p.a.v, q.a.v, r.a.v);
