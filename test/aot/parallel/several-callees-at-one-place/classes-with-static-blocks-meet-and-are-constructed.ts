const unseen = (x: any): any => [x][JSON.parse("0")];
const held: any = { k: 0 };
const told: string[] = [];
let logged = "";
class A { static count = 0; static { logged += "sA" + A.count; } static idle(): number { return 1; } k = 1; constructor(n: any) { A.count++; } idle(): number { return 1; } }
class B { static count = 10; static first: any; static { B.first = new B(-1); logged += "sB" + B.count; } static idle(): number { return 2; } k = 2; constructor(n: any) { B.count += 2; } idle(): number { return 2; } }
class D { static count = 100; static bump(): number { return ++D.count; } static { logged += "sD" + D.bump(); } k = 3; constructor(n: any) { D.bump(); } idle(): number { return 3; } }
function make(C: any, ...a: any[]): any { held.k = a[0]; return new C(a[0]); }
function run(n: number): string { let out = ""; for (let i = 0; i < n; i++) { let f: any; switch (i % 3) { case 0: f = A; break; case 1: f = B; break; default: f = D; } const got = make(f, ...[i]); out += got.k; } return out + "," + A.count + "," + B.count + "," + D.count + "," + B.first.k; }
for (const n of unseen([1, 2, 9]) as number[]) told.push(run(n) + "|" + logged);
console.log(told.join("\n"));
export {};
