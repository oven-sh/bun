class Shelf { constructor(inner) { this.inner = inner; } get width() { return this.inner.width; } get inset() { return this.inner.inset ?? 3; } at(i) { return i * this.width + this.inset; } }
const shelf = new Shelf(JSON.parse("null"));
function run(turns) { let s = 0; for (let i = 0; i < turns; i++) s += shelf.at(i & 7); return s; }
function attempt(turns) { try { return run(turns); } catch (error) { return error.constructor.name + ": " + error.message; } }
console.log(run(0), attempt(0), attempt(9));
