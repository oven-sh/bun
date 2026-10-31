// Many long-lived pairs of an object and the object in its field, read and stored through again and again, beside short-lived ones.
interface Inner { d: number; e: number }
interface Outer { b: number; c: Inner; next: Outer | null }
function make(n: number): Outer | null {
  let head: Outer | null = null;
  for (let i = 0; i < n; i++) head = { b: i, c: { d: i * 2, e: i * 3 }, next: head };
  return head;
}
function sum(head: Outer | null): number {
  let total = 0;
  for (let p = head; p; p = p.next) total += p.c.d + p.c.e + p.b;
  return total;
}
function bump(head: Outer | null): void {
  for (let p = head; p; p = p.next) { p.c.d += 1; p.c.e += 2; }
}
let answer = 0;
const kept = make(20000);
for (let round = 0; round < 20; round++) { bump(kept); answer += sum(kept); }
for (let round = 0; round < 20; round++) answer += sum(make(2000));
console.log(answer);
