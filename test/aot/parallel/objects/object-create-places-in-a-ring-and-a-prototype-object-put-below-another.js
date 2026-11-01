// Three places of Object.create(), each handed what the one before it made, and the first handed what the last made. Then an object that lies above others gets another prototype.
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
function three(below) {
  const created = Object.create(below);
  created.c = 3;
  return created;
}
const first = one(null);
const second = two(first);
const third = three(second);
const again = one(third);
console.log(again.a, again.b, again.c, again.other, Object.keys(again).join());
Object.setPrototypeOf(second, { other: 5 });
console.log(again.a, again.b, again.c, again.other, Object.keys(again).join(), Object.getPrototypeOf(second) === first);
