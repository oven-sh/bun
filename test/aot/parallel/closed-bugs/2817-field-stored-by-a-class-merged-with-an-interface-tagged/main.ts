interface Base { kind: 1 | 2 }
interface A extends Base { kind: 1; a: number }
interface B extends Base { kind: 2; b: number }
interface N extends Base {}
class N { constructor(kind: 1 | 2) { this.kind = kind; } }
const x = new N(1) as unknown as A; x.a = 5;
const y = new N(2) as unknown as B; y.b = 6;
console.log(Object.keys(x).join(), JSON.stringify(y), x.kind, y.kind);
