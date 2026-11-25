class Vec { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } len() { return this.x + this.y + this.z; } get sum() { return this.x * 2; } }
const lines = [];
const show = v => lines.push(typeof v.x + " " + v.x + " " + v.y + " " + v.z + " " + v.len() + " " + Object.keys(v).join());
const v = new Vec(1, 2, 3), w = new Vec(4, 5, 6);
const name = text => JSON.parse(JSON.stringify(text));
Object.defineProperty(Vec.prototype, name("late"), { get() { this.z = "got"; return 1; }, configurable: true }); let s = 0; for (const k of ["x", "late"]) s += v[k]; lines.push(s);
show(v); show(w); show(new Vec(7, 8, 9));
console.log(lines.join("\n"));
