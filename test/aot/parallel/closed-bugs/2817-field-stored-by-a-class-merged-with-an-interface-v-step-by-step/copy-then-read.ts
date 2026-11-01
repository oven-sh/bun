interface Base { kind: 1 | 2 }
interface A extends Base { kind: 1; a: number }
interface B extends Base { kind: 2; b: number }
interface N extends Base {}
class N { constructor(kind: 1 | 2) { this.kind = kind; } }
function show(v: any): string { return typeof v + ":" + v; }
const n = new N(1) as unknown as A; n.a = 5;
const m = new N(2) as unknown as B; m.b = 6;
const c: any = Object.assign({}, n);
const d: any = Object.assign({}, m);
console.log(String(c.kind), String(d.kind));
console.log(Object.keys(c).join(), Object.keys(d).join());
console.log(show(c.kind), show(d.kind), show(c.a), show(d.b));
