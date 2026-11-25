const unseen = (x: any): any => [x][JSON.parse("0")];
const held: any = { k: 0 };
const told: string[] = [];
const pool: any[] = [];
class A { k = 1; constructor(n: any) { if (pool.length) return pool[0]; pool.push(this); } m(): any { return "A" + this.k; } idle(): number { return 1; } }
class B { k = 2; constructor(n: any) { return { k: n, m: () => "literal" + n } as any; } m(): any { return "B"; } idle(): number { return 2; } }
class D { k = 3; constructor(n: any) { return (n & 1 ? 5 : undefined) as any; } m(): any { return "D" + this.k; } idle(): number { return 3; } }
class Above { k = 4; constructor(n: any) { return n === 7 ? new A(n) as any : this; } m(): any { return "Above" + this.k; } }
class Below extends Above { l = 5; constructor(n: any) { super(n); this.k += 10; } idle(): number { return 5; } }
function make(C: any, ...a: any[]): any { held.k = a[0]; return new C(a[0]); }
function run(n: number): string { let out = ""; for (let i = 0; i < n; i++) { let f: any; switch (i & 3) { case 0: f = A; break; case 1: f = B; break; case 2: f = D; break; default: f = Below; } const got = make(f, ...[i]); got.k++; out += got.m() + Object.keys(got).join() + (got instanceof A) + ";"; } return out; }
for (const n of unseen([1, 2, 9]) as number[]) told.push(run(n) + "|" + pool.length);
console.log(told.join("\n"));
export {};
