// Static fields read by the body that makes the class, before its initializer, in it and behind it, and by functions that loops call while the fields are stored.
const K: any = JSON.parse("3"); const said: any[] = [];
class Complex { constructor(readonly re: number, readonly im: number) {} static readonly ZERO = new Complex(0, 0); static readonly ONE = new Complex(1, 0); mul(o: Complex): Complex { return new Complex(this.re * o.re - this.im * o.im, this.re * o.im + this.im * o.re); } add(o: Complex): Complex { return new Complex(this.re + o.re, this.im + o.im); } }
let z = Complex.ZERO; for (let i = 0; i < 20; i++) z = z.mul(z).add(new Complex(0.1, 0.2)); console.log(z.re.toFixed(6), z.im.toFixed(6), Complex.ZERO.re, Complex.ONE.mul(Complex.ONE).re);
class Early { static A = said.push(String((Early as any).B)); static B = [1, 2]; static C = Early.B.length; }
const early = Early.B; console.log(said.join(), early.join(), Early.C);
const Held = class Named { static A: any = Named.make(); static make(): any { return { before: typeof (Named as any).B }; } static B = [K]; }; console.log(JSON.stringify(Held.A), Held.B[0]);
class Counter { static items: number[] = []; static total = 0; static add(x: number): void { Counter.items = [...Counter.items, x]; Counter.total += x; } }
function size(): number { return Counter.items.length; }
let sum = 0; for (let i = 0; i < 6; i++) { sum += size(); if (i & 1) Counter.add(i); sum += size() * 10; } console.log(sum, Counter.total, Counter.items.join());
function swap(): void { Counter.items = [7]; }
let seen = ""; for (let i = 0; i < 4; i++) { seen += size(); if (i === 1) swap(); if (i === 2) Counter.items.push(1, 2); } console.log(seen);
try { class Broken { static A = [1]; static B = (() => { said.push(Broken.A); throw new RangeError("no"); })(); } console.log(Broken.A); } catch (e: any) { console.log(e.name, said.length); }
for (let round = 0; round < 2; round++) { class Again { static A = [round]; static B = Again.A; } console.log(Again.A[0], Again.A === Again.B); }
switch (K) { case 3: class Inside { static A = new Map([[1, 2]]); } console.log(Inside.A.get(1)); break; default: console.log("none"); }
class Parent { static A = [1]; static get B(): number { return this.A.length; } } class Heir extends Parent { static C = super.B; } console.log(Heir.A[0], Heir.B, Heir.C, Parent.A === Heir.A);
export {};
