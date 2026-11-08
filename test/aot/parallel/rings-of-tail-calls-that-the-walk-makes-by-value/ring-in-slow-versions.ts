class A { v = 1; w = 2; }
class B { z = 0; w = 5; v = 7; }
class Ring {
  even(n: number, t: A): number {
    let work = 0;
    for (let i = 0; i < 2; i++) work = (work + t.v + t.w) | 0;
    if (n === 0) return work;
    return this.odd(n - 1, t);
  }
  odd(n: number, t: A): number {
    let work = 0;
    for (let i = 0; i < 2; i++) work = (work + t.w + t.v) | 0;
    if (n === 0) return (work + 1) | 0;
    return this.even(n - 1, t);
  }
}
const ring = new Ring();
console.log(ring.even(1000000, new A()));
let answer: number | string;
try { answer = ring.even(1000000, new B() as unknown as A); } catch (e) { answer = (e as Error).name; }
console.log(answer);
