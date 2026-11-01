// Two places of Object.create(), each handed what the other made. Then an object that lies above the others loses a property.
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
console.log(again.a, second.a, first.a);
delete first.a;
console.log(again.a, second.a, first.a, Object.keys(first).length);
