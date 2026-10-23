// One arm of a conditional gives what Object.create(A.prototype) made, out of a variable of type `A | null`, the other an instance of B. Two fields that B declares as numbers are stored on whichever it is.
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
function put(first: boolean, value: number) {
  const it = held;
  if (it === null) return 0;
  const either: A | B = first ? it : made[0];
  (either as any).x = value;
  (either as any).y = value + 1;
  return 1;
}
held = Object.create(A.prototype);
(held as any).first = "first";
(held as any).second = "second";
console.log(put(true, 1.5), put(false, 3.5));
console.log(JSON.stringify(held), Object.keys(held as object).join(), made[0].x, made[0].y);
