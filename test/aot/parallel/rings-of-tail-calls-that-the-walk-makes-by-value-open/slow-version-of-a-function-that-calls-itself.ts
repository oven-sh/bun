class A { v = 1; w = 2; }
class B { z = 0; w = 5; v = 7; }
function down(n: number, t: A): number { let work = 0; for (let i = 0; i < 2; i++) work = (work + t.v + t.w) | 0; if (n === 0) return work; return down(n - 1, t); }
console.log(down(1000000, new A()));
let answer: number | string; try { answer = down(1000000, new B() as unknown as A); } catch (e) { answer = (e as Error).constructor.name; }
console.log(answer);
