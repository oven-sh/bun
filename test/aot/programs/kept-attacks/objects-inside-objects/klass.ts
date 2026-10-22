// Objects inside objects, one probe of many. It prints what plain Bun prints.
class Vec { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } len() { return this.x * this.x + this.y * this.y; } }
class Body { id: number; pos: Vec; name: string; constructor(i: number) { this.id = i; this.pos = new Vec(i, i + 1); this.name = "b" + i; } move(d: number) { this.pos.x += d; return this; } }
class Sub extends Body { extra: number; constructor(i: number) { super(i); this.extra = i * 2; } }
const all: Body[] = [];
for (let i = 0; i < 5000; i++) all.push(i % 4 ? new Body(i) : new Sub(i));
const positions = all.map(b => b.pos);
Bun.gc(true);
let s = 0;
for (let i = 0; i < all.length; i++) { all[i].move(1); s += positions[i].len() + (positions[i] === all[i].pos ? 1 : 0) + (all[i].pos instanceof Vec ? 1 : 0) + all[i].name.length; }
console.log(s, all[0] instanceof Sub, (all[0] as Sub).extra, JSON.stringify(all[3]));
all.length = 0; Bun.gc(true);
let t = 0; for (const p of positions) t += p.x + p.y;
console.log(t);
