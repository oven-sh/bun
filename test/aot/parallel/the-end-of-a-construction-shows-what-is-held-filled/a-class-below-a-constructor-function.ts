function Base(this: any, a: number) { this.a = a; }
class Below extends (Base as any) { b: number; constructor(a: number, b: number) { super(a); this.b = b; } }
class Lowest extends Below { c: number; constructor(a: number) { super(a, a + 1); this.c = a + 2; } }
function run(count: number): number { let total = 0; for (let i = 0; i < count; i++) { const item: any = new Below(i & 1023, 2); const low: any = new Lowest(i & 7); total += item.a + item.b + low.a + low.b + low.c; } return total; }
console.log(run(10), run(300));
const plain: any = new (Base as any)(4);
console.log(plain.a, Object.keys(plain).join(), Object.keys(new Lowest(1)).join());
export {};
