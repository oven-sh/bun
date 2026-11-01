// A place of Object.create() is handed Object.prototype, and then an object that it made itself below Object.prototype and that another place has since made an object below.
function make(below) {
  const created = Object.create(below);
  created.items = 8;
  return created;
}
function leaf(below) {
  const created = Object.create(below);
  created.extra = 1;
  return created;
}
const made = [];
made.push(make(made[0] ?? Object.prototype));
made.push(leaf(make(Object.prototype)));
made.push(make(Object.getPrototypeOf(made[made.length - 1] ?? {})));
for (const object of made) {
  const below = Object.getPrototypeOf(object);
  console.log(
    object.items,
    object.extra,
    Object.keys(object).join(),
    below === Object.prototype ? "Object.prototype" : Object.keys(below).join(),
  );
}
