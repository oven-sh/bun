// One Object.create() in a loop over two written names, handed what a second place made, which is handed what the loop made. A third place is handed what the loop made for the last name.
const target = {};
const store = {};
const state = { previous: null };
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
for (const name of ["x", "y"]) {
  target[name] = function () {
    return name;
  };
  const created = Object.create(state.previous);
  created.a = 1;
  store[name] = created;
  state.previous = two(created);
}
const last = three(store.y);
console.log(target.x(), target.y(), last.a, last.b, last.c, last.late);
store.x.late = 4;
console.log(last.a, last.b, last.c, last.late);
