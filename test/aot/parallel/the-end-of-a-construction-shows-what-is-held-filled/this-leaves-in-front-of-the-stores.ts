const seen: string[] = [];
function register(x: { a?: number; b?: number }): void { seen.push(typeof x.a + ":" + String(x.a) + "," + typeof x.b + ":" + String(x.b)); }
class Early { a: number; b: number; constructor(a: number) { this.a = a; register(this); this.b = a * 2; register(this); } }
function EarlyF(this: { a: number; b: number }, a: number) { register(this); this.a = a; register(this); this.b = a * 2; }
const Early2 = EarlyF as unknown as { new (a: number): { a: number; b: number } };
function sum(x: { a: number; b: number }): number { return x.a + x.b; }
let total = 0;
for (let i = 0; i < 300; i++) total += sum(new Early(i)) + sum(new Early2(i));
console.log(total, seen.length, seen[0], seen[1], seen[2], seen[3], seen[seen.length - 1]);
export {};
