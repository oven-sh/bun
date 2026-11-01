// Two places of Object.create(), each handed what the other made. Then an object that lies above another gets a new property.
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
const again = one(two(first));
console.log(again.a, again.b, again.late);
first.late = 4;
console.log(again.a, again.b, again.late, Object.keys(first).join());
