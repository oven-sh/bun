// Two places of Object.create(), each handed what the other made, by calls in a loop. Then an object that lies above the others gets a new property.
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
let top = null;
let first = null;
for (let turn = 0; turn < 2; turn++) {
  const made = one(top);
  if (turn === 0) first = made;
  top = two(made);
}
console.log(top.a, top.b, top.late);
first.late = 4;
console.log(top.a, top.b, top.late, Object.keys(first).join());
