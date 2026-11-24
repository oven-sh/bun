class Base { x: number; y: number; constructor(b: number) { this.x = b; this.y = b + 1; } }
class Child extends Base { z: number; constructor(b: number) { super(b); this.z = b + 2; } }
function other(o: Base, p: Child, v: number) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; const a = o.x; p.z = v; return a + o.x + p.z; }
function same(o: Base, p: Child, v: number) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; const a = o.x; p.z = v; p.x = v + 1; p.y = v + 2; return a + o.x + o.y; }
const c = new Child(JSON.parse("10")); console.log(other(c, c, 7), same(c, c, 10));
