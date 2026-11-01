// A place of Object.create() is handed an object that it made itself, and another place is handed the same object afterwards.
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
const first = make(made[0] ?? null);
made.push(first);
made.push(make(first));
made.push(leaf(first));
made.push(make(Object.getPrototypeOf(made[made.length - 1] ?? {})));
for (const object of made) {
  const below = Object.getPrototypeOf(object);
  console.log(object.items, object.extra, Object.keys(object).join(), below === null ? "null" : below === first);
}
