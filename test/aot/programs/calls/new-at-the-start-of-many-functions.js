// One constructor is called with `new` at the start of several functions that each run a few times, and each adds properties of its own right after. What one place makes says nothing about what the next one makes.
function Point(x, y) { this.x = x; this.y = y; }
function plain() { const p = new Point(1, 2); return p; }
function withZ() { const p = new Point(1, 2); p.z = 3; return p; }
function withTwo() { const p = new Point(1, 2); p.a = 4; p.b = 5; return p; }
function withOther() { const p = new Point(1, 2); p.b = 6; return p; }
function withoutX() { const p = new Point(1, 2); p.z = 3; delete p.x; return p; }
for (let round = 0; round < 3; round++) {
  for (const make of [withZ, plain, withTwo, withOther, withoutX, plain]) {
    const p = make();
    console.log(make.name, JSON.stringify(p), Object.keys(p).join(), p.z, p.a, p.b);
  }
}
withZ();
console.log(JSON.stringify(new Point(7, 8)));
