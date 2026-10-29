// Long-lived pairs, with the outer object made first and out in the world before the inner one is made and stored.
interface Inner { d: number; e: number }
interface Outer { b: number; c: Inner | undefined; next: Outer | null }
let last: Outer | null = null
function make(n: number): Outer | null {
  let head: Outer | null = null;
  for (let i = 0; i < n; i++) {
    const outer: Outer = { b: i, c: undefined, next: head };
    last = outer;
    outer.c = { d: i * 2, e: i * 3 };
    head = outer;
  }
  return head;
}
function sum(head: Outer | null): number {
  let total = 0;
  for (let p = head; p; p = p.next) total += p.c!.d + p.c!.e + p.b;
  return total;
}
function bump(head: Outer | null): void {
  for (let p = head; p; p = p.next) { p.c!.d += 1; p.c!.e += 2; }
}
let answer = 0;
const kept = make(20000);
for (let round = 0; round < 20; round++) { bump(kept); answer += sum(kept); }
for (let round = 0; round < 20; round++) answer += sum(make(2000));
console.log(answer, last !== null);
