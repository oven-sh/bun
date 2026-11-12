const unseen = (x: any): any => [x][JSON.parse("0")];
const held: any = { k: 0 };
const told: string[] = [];
let logged = "";
class A { #v = 1; constructor(n: any) { this.#v += this.#twice(n); } #twice(n: number): number { return n * 2; } #idle(): number { return 1; } show(): string { return "A" + this.#v; } static has(o: any): boolean { return #v in o; } }
class B { #v = 2; constructor(n: any) { logged += "B" + this.#size; this.#size = n; } get #size(): number { return this.#v; } set #size(n: number) { this.#v = n + 5; } #idle(): number { return 2; } show(): string { return "B" + this.#v; } static #count = 0; static #bump(): number { return ++B.#count; } static bumped(): number { return B.#bump(); } }
class D { #v = 3; constructor(n: any) { if (n === 5) return { show: () => "stranger" } as any; } show(): string { return "D" + this.#v; } static read(o: any): number { return o.#v; } }
function make(C: any, ...a: any[]): any { held.k = a[0]; return new C(a[0]); }
function run(n: number): string { let out = ""; for (let i = 0; i < n; i++) { try { let f: any; switch (i % 3) { case 0: f = A; break; case 1: f = B; break; default: f = D; } const got = make(f, ...[i]); out += got.show() + A.has(got) + B.bumped(); out += D.read(got); } catch (e) { out += (e as Error).constructor.name; } } return out; }
for (const n of unseen([1, 2, 9]) as number[]) { told.push(run(n) + "|" + logged); logged = ""; }
console.log(told.join("\n"));
export {};
