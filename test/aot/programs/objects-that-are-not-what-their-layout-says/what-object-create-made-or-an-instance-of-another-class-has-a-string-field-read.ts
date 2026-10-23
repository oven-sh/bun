// One arm of a conditional, of `??` or of a loop gives what Object.create(A.prototype) made, out of a variable of type `A | null`, the other an instance of B. A field that B declares as a string is read from whichever it is.
class A {}
class B {
  a = 1; b = 2; c = 3; d = 4; e = 5; f = 6; g = 7; h = 8;
  z = "s";
}
let held: A | null = null;
const made: B[] = [new B()];
function conditional(first: boolean) {
  const it = held;
  if (it === null) return 0;
  const either: A | B = first ? it : made[0];
  const text = (either as any).z;
  return text === undefined ? -1 : text.length + text.charCodeAt(0);
}
function coalesced() {
  const either: A | B = held ?? made[0];
  const text = (either as any).z;
  return text === undefined ? -1 : text.length + text.charCodeAt(0);
}
function aroundALoop(turns: number) {
  let either: A | B = made[0];
  let total = 0;
  for (let turn = 0; turn < turns; turn++) {
    const text = (either as any).z;
    total += text === undefined ? -1 : text.length;
    const it = held;
    if (it !== null) either = it;
  }
  return total;
}
console.log(conditional(true), conditional(false), coalesced(), aroundALoop(3));
held = Object.create(A.prototype);
console.log(conditional(true), conditional(false), coalesced(), aroundALoop(3));
(held as any).z = "longer";
console.log(conditional(true), conditional(false), coalesced(), aroundALoop(3));
