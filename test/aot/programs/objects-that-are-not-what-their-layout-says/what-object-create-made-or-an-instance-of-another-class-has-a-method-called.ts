// One arm of a conditional gives what Object.create(A.prototype) made, out of a variable of type `A | null`, the other an instance of B. A method of B is called on whichever it is.
class A {}
class B {
  n = 3;
  twice() {
    return this.n * 2;
  }
}
let held: A | null = null;
const made: B[] = [new B()];
function call(first: boolean) {
  const it = held;
  if (it === null) return 0;
  const either: A | B = first ? it : made[0];
  try {
    return (either as any).twice();
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
held = Object.create(A.prototype);
console.log(call(true), call(false));
(held as any).twice = () => "its own";
console.log(call(true), call(false));
