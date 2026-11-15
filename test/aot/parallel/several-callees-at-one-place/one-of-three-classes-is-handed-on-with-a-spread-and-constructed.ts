const unseen = (x: any): any => [x][JSON.parse("0")];
const told: string[] = [];
let logged = ""; const kept: any[] = []; function log(t: string): void { logged += t; } function arg(n: number): number { logged += n; return n; }
class A { k = 1; constructor(n: any) { log('A' + (new.target === A)); } m(): any { return 1; } } class B { k = 2; constructor(n: any) { return { k: n, m: () => n } as any; } m(): any { return 2; } } class D { k = 3; constructor(n: any) { if (n === 5) throw new RangeError('D'); } m(): any { return 3; } }
function make(C: any, ...a: any[]): any { return new C(a[0]); } function apply(f: any, ...a: any[]): any { return f(a[0]); }
function run(n: number): string { let out = ""; for (let i = 0; i < n; i++) { try { let f: any; switch (i % 3) { case 0: f = A; break; case 1: f = B; break; default: f = D; } const got = make(f, ...[i]); out += typeof got; } catch (e) { out += (e as Error).constructor.name; } } return out; }
for (const n of unseen([1, 2, 9]) as number[]) { let got = ""; try { got = run(n); } catch (e) { got = (e as Error).constructor.name; } told.push(got + "|" + logged + "|" + kept.length); }
console.log(told.join("\n"));
export {};
