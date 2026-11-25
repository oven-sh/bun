function count(o, n) { let c = 0; for (let i = 0; i < n; i++) { if (o.kind === "const") c++; else c += o.kind.length; o = o.next; } return c; }
globalThis.kept = count;
const ring = { kind: "const" }; ring.next = { kind: "let", next: ring };
let all = 0;
for (let turn = 0; turn < 3000; turn++) all = (all * 7 + count(ring, 5 + turn % 3)) % 1000003;
delete ring.next.kind;
try { all += count(ring, 4); } catch (error) { all += error.name.length; }
console.log(all);
