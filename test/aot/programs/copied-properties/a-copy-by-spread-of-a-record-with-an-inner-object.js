// The inner object lies in the cell of the outer one where the compiler can arrange it; a copy has another cell.
function make(i) { return { id: i, inner: { x: i, y: i + 1 } }; }
function copy(s) { return { ...s }; }
function sum(o) { return o.inner.x + o.inner.y + o.id; }
let total = 0, same = 0;
const kept = [];
for (let i = 0; i < 2000; i++) {
  const source = make(i);
  const made = copy(source);
  if (made.inner === source.inner) same++;
  made.inner.x += 1;
  total += sum(made) + sum(source);
  if ((i & 255) === 0) kept.push(made);
}
if (typeof Bun !== "undefined") Bun.gc(true);
console.log(total, same, JSON.stringify(kept));
