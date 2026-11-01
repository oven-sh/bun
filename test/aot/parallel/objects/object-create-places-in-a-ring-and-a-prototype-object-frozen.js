// Two places of Object.create(), each handed what the other made. Then an object that lies above the others is frozen.
function one(below) {
  const created = Object.create(below);
  created.a = 1;
  return created;
}
function two(below) {
  const created = Object.create(below);
  created.b = 2;
  return created;
}
const first = one(null);
const second = two(first);
const again = one(second);
Object.freeze(first);
let refused = false;
try {
  second.a = 5;
} catch (error) {
  refused = error instanceof TypeError;
}
again.a = 9;
console.log(again.a, again.b, second.a, first.a, refused, Object.isFrozen(first), Object.isFrozen(second));
