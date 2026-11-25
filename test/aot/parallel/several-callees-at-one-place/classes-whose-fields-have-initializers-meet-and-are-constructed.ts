const unseen = (x: any): any => [x][JSON.parse("0")];
const held: any = { k: 0 };
const told: string[] = [];
let logged = "";
let made = 0;
function note(text: string): number { logged += text; return ++made; }
class A { first = note("a1"); own = () => this.first; second: any = this.first + 1; constructor(n: any) { logged += "A" + this.second; } idle(): number { return 1; } }
class B { first = note("b1"); list: number[] = [this.first]; ["computed"] = note("b2"); constructor(n: any) { logged += "B" + this.list.length; if (n === 4) throw new RangeError("B"); } idle(): number { return 2; } }
class D { first: any = made; thrower: any = made > 12 ? (() => { throw new TypeError("D"); })() : 0; idle(): number { return 3; } }
function make(C: any, ...a: any[]): any { held.k = a[0]; return new C(a[0]); }
function run(n: number): string { let out = ""; for (let i = 0; i < n; i++) { try { let f: any; switch (i % 3) { case 0: f = A; break; case 1: f = B; break; default: f = D; } const got = make(f, ...[i]); out += Object.keys(got).join() + String(got.first) + (got.own ? got.own() : "-"); } catch (e) { out += (e as Error).constructor.name; } } return out; }
for (const n of unseen([1, 2, 9]) as number[]) { told.push(run(n) + "|" + logged + "|" + made); logged = ""; }
console.log(told.join("\n"));
export {};
