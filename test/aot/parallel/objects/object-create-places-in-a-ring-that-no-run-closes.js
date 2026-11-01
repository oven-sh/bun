// Two places of Object.create() that would be handed each other's objects, by a call that no run makes. Then an object that lies above another gets a new property.
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
if (process.argv.length > 5) one(second);
console.log(second.a, second.b, second.late);
first.late = 4;
console.log(second.a, second.b, second.late);
