const unseen = (x: any): any => [x][JSON.parse("0")];
const held: any = { k: 0 };
const told: string[] = [];
const name: string = unseen("dynamic");
const idle: string = unseen("idle");
const mark = Symbol("mark");
class A { k = 1; constructor(n: any) { this.k += n; } [name](): number { return this.k; } [idle](): number { return 1; } [Symbol.iterator](): any { return [this.k, 1][Symbol.iterator](); } static [idle](): number { return 10; } }
class B { k = 2; constructor(n: any) { this.k *= n; } [name](): number { return -this.k; } [mark](): number { return 2; } get [idle](): number { return 2; } }
class D { k = 3; constructor(n: any) { } [name](): number { return 3; } [mark](): number { return 30; } 7(): number { return 7; } }
function make(C: any, ...a: any[]): any { held.k = a[0]; return new C(a[0]); }
function run(n: number): string { let out = ""; for (let i = 0; i < n; i++) { try { let f: any; switch (i % 3) { case 0: f = A; break; case 1: f = B; break; default: f = D; } const got = make(f, ...[i]); out += got[name]() + ","; out += got[mark] ? got[mark]() : [...got].join("+"); out += ";"; } catch (e) { out += (e as Error).constructor.name; } } return out; }
for (const n of unseen([1, 2, 9]) as number[]) told.push(run(n));
console.log(told.join("\n"));
export {};
