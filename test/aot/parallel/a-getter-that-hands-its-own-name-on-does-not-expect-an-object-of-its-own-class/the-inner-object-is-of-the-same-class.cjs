class Shelf { constructor(inner) { this.inner = inner; } get width() { return this.inner.width; } get inset() { return this.inner.inset ?? 3; } at(i) { return i * this.width + this.inset; } }
const shelf = new Shelf(new Shelf(new Shelf(JSON.parse("{\"width\":4,\"inset\":1}"))));
function run(turns) { let s = 0; for (let i = 0; i < turns; i++) s += shelf.at(i & 7); return s; }
console.log(run(9), run(0));
