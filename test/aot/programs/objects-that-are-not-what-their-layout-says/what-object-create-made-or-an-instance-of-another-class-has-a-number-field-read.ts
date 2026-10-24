// One arm of a conditional gives what Object.create(A.prototype) made, out of a variable of type `A | null`, the other an instance of B. Two fields that B declares as numbers are read from whichever it is.
class A {}
class B {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}
let held: A | null = null;
const made: B[] = [new B(1.5, 2.5)];
function sum(first: boolean): number {
  const it = held;
  if (it === null) return 0;
  const either: A | B = first ? it : made[0];
  return (either as any).x + (either as any).y;
}
console.log(sum(true), sum(false));
held = Object.create(A.prototype);
console.log(sum(true), sum(false));
(held as any).x = "a";
(held as any).y = "b";
console.log(sum(true), sum(false));
