// @ts-nocheck
// STATISTIC: AssignedMemberChecks >= 7
// Two and three decorators on one method, and one decorator on two methods: each wrapper captures the function below it.
const show = (label: string, f: () => unknown) => { let r; try { r = f(); } catch (e: any) { r = `${e.name}: ${e.message}`; } console.log(label, r); };
function add(f: any, c: any) { return function (this: any, n: number) { return f.call(this, n) + 1; }; }
function double(f: any, c: any) { return function (this: any, n: number) { return f.call(this, n) * 2; }; }
const scale = (k: number) => (f: any, c: any) => function (this: any, ...r: any[]) { return f.apply(this, r) * k; };
function keep(f: any, c: any) { }
class Two { k = 2; @add @double m(n: number) { return n + this.k; } @double @add q(n: number) { return n - this.k; } }
class Three { k = 3; @add @scale(5) @double m(n: number) { return n + this.k; } @keep @add q(n: number) { return n; } }
class Same { k = 4; @add @add m(n: number) { return n + this.k; } @add q(n: number) { return n * this.k; } }
class Heir extends Two { m(n: number) { return super.m(n) + 100; } }
const loop = (o: any) => { let s = 0; for (let i = 0; i < 200; i++) s += o.m(i & 3) + o.q(i & 7); return s; };
show("two", () => loop(new Two()));
show("three", () => loop(new Three()));
show("same", () => loop(new Same()));
show("heir", () => loop(new Heir()));
function alone() { class A { k = 2; @add @double m(n: number) { return n + this.k; } } const a = new A(); let s = 0; for (let i = 0; i < 300; i++) s = (s + a.m(i & 3)) | 0; return s; }
show("alone", alone);
Two.prototype.m = function (n: number) { return n; };
show("replaced", () => loop(new Two()));
show("heir again", () => loop(new Heir()));
delete (Two.prototype as any).q;
show("deleted", () => loop(new Two()));
export {};
