class Item { constructor(id, x, y) { this.id = id; this.x = x; this.y = y; this.inner = { x: y, y: x }; } }
class Table { constructor() { this.list = []; } fill(n, r) { this.list = []; for (let i = 0; i < n; i++) this.list.push(new Item(i, (i * 37 + r) % 11, (i * 5 + r) % 7)); }
  byFields() { this.list.sort((a, b) => a.x - b.y); return this.list; }
  byInner() { this.list.sort((a, b) => a.inner.x - b.inner.y); return this.list; }
  byDepth() { this.list.sort((a, b) => b.inner.y - a.x); return this.list; }
  byConstants() { this.list.sort((a, b) => a.x * 2 - b.x * 3); return this.list; }
  bySame() { this.list.sort((a, b) => a.x - a.x); return this.list; }
}
const show = list => list.map(v => v.id).join();
const table = new Table();
function rounds(out) { for (let r = 0; r < 24; r++) { table.fill(3 + r, r); out.push(show(table.byFields())); table.fill(3 + r, r); out.push(show(table.byInner())); table.fill(3 + r, r); out.push(show(table.byDepth())); table.fill(3 + r, r); out.push(show(table.byConstants()), show(table.bySame())); } return out; }
console.log(rounds([]).join("\n"));
