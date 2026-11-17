// A loop asks in front of itself whether the class of its resources keeps its dispose method.
let total = 0;
const order: string[] = [];
class Base {}
class Plain extends Base { [Symbol.dispose](): void { total++; } }
class Counted { n: number; constructor(n: number) { this.n = n; } [Symbol.dispose](): void { total += this.n; } }
class Named extends Counted { [Symbol.dispose](): void { super[Symbol.dispose](); total += 1000; } }
class Own { [Symbol.dispose]: () => void = () => { total += 7; }; }
function plain(n: number): number { for (let i = 0; i < n; i++) { using r = new Plain(); total += i; } return total; }
function counted(n: number): number { for (let i = 0; i < n; i++) { using r = new Counted(i); total ^= 1; } return total; }
function named(n: number): number { for (let i = 0; i < n; i++) { using r = new Named(i); if (i === 4) continue; total++; } return total; }
function own(n: number): number { for (let i = 0; i < n; i++) { using r = new Own(); total++; } return total; }
function two(n: number): number { for (let i = 0; i < n; i++) { using a = new Plain(); using b = new Counted(i); total++; } return total; }
function throws(n: number): number { for (let i = 0; i < n; i++) { using a = new Plain(); if (i === 3) throw new Error("body"); } return total; }
function changes(n: number): number { for (let i = 0; i < n; i++) { using a = new Plain(); if (i === 2) (Plain.prototype as any)[Symbol.dispose] = function () { total += 50; }; } return total; }
function changesInDispose(n: number): number { for (let i = 0; i < n; i++) { using a = new Counted(i); if (i === 2) (Counted.prototype as any)[Symbol.dispose] = function (this: Counted) { total += this.n * 2; delete (Counted.prototype as any)[Symbol.dispose]; }; } return total; }
function ownOnOne(n: number): number { for (let i = 0; i < n; i++) { const p: any = new Plain(); if (i === 1) p[Symbol.dispose] = () => { total += 900; }; using a = p; } return total; }
function accessor(n: number): number { for (let i = 0; i < n; i++) { using a = new Plain(); total++; } return total; }
function answer(name: string, run: () => number): void { let text: string; try { text = String(run()); } catch (error) { text = (error as Error).name + ": " + (error as Error).message; } order.push(name + " " + text + " " + total); }
for (const n of [0, 1, 6, 40]) for (const [name, f] of Object.entries({ plain, counted, named, own, two, throws, ownOnOne })) answer(name, () => f(n));
const before = Plain.prototype[Symbol.dispose];
for (const n of [0, 6, 40]) { answer("changes", () => changes(n)); answer("plain", () => plain(n)); Plain.prototype[Symbol.dispose] = before; answer("plain", () => plain(n)); }
Object.defineProperty(Plain.prototype, Symbol.dispose, { configurable: true, get() { total += 3; return before; } });
for (const n of [0, 6, 40]) answer("accessor", () => accessor(n));
delete (Plain.prototype as any)[Symbol.dispose];
for (const n of [0, 6]) answer("deleted", () => plain(n));
(Base.prototype as any)[Symbol.dispose] = function () { total += 11; };
for (const n of [0, 6]) answer("inherited", () => plain(n));
delete (Base.prototype as any)[Symbol.dispose];
for (const n of [0, 6]) answer("deleted again", () => plain(n));
for (const n of [0, 2, 6]) { answer("changes in dispose", () => changesInDispose(n)); answer("named", () => named(n)); }
for (const line of order) console.log(line);
console.log(order.length, total);
