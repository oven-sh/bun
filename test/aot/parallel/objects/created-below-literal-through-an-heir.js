// Two places of Object.create(): the second makes objects below what the first makes. The first place is handed null first. Then the second place is handed an object below the literal
// that no place of this program made: it comes out of a text. After that the first place is handed the literal in a loop: each object is below the literal and has its method.
const base = { twice(x) { return x * 2; } };
function make(below, i) {
  const made = Object.create(below); // not a tail call
  made.items = i;
  return made;
}
function leaf(below) {
  const made = Object.create(below); // not a tail call
  made.extra = 1;
  return made;
}
function use(n) {
  let total = 0;
  for (let i = 0; i < n; i++) total += make(base, i).twice(i);
  return total;
}
function attempt(run) { try { return run(); } catch (e) { return e.constructor.name; } }

const foreign = Object.setPrototypeOf(JSON.parse("{}"), base);
console.log(Object.getPrototypeOf(make(JSON.parse("null"), 1)) === null);
const heir = leaf(foreign);
console.log(Object.getPrototypeOf(Object.getPrototypeOf(heir)) === base);
console.log(attempt(() => use(10)));
console.log(Object.getPrototypeOf(make(base, 5)) === base);
let wrong = 0;
for (let turn = 0; turn < 1000; turn++) wrong += attempt(() => use(3)) !== 6;
console.log(wrong);
console.log(attempt(() => leaf(make(base, 0)).twice(4)));
