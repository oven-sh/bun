const unseen = (x: any): any => [x][JSON.parse("0")];
const held: any = { k: 0 };
const told: string[] = [];
let logged = "";
class A { v = 1; constructor(n: any) { this.size = n; } get size(): any { logged += "gA"; return this.v; } set size(n: any) { logged += "sA"; this.v = n + 1; } get idle(): number { return 1; } set idle(n: number) { logged += "never"; } }
class B { v = 2; constructor(n: any) { logged += "B" + this.size; } get size(): any { logged += "gB"; return this.v * 2; } get idle(): number { return 2; } static get idleToo(): number { return 2; } }
class D { v = 3; size: any = 7; constructor(n: any) { this.size = n; } set idle(n: number) { logged += "never"; } }
function make(C: any, ...a: any[]): any { held.k = a[0]; return new C(a[0]); }
function run(n: number): string { let out = ""; for (let i = 0; i < n; i++) { try { let f: any; switch (i % 3) { case 0: f = A; break; case 1: f = B; break; default: f = D; } const got = make(f, ...[i]); out += got.size; got.size = i + 10; out += "," + got.size + ";"; } catch (e) { out += (e as Error).constructor.name; } } return out; }
for (const n of unseen([1, 2, 9]) as number[]) { told.push(run(n) + "|" + logged); logged = ""; }
console.log(told.join("\n"));
export {};
