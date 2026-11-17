const box = { held: 0 };
const kind = {
  [Symbol.hasInstance](value) {
    box.held = box.held + 3;
    return box.held !== 9;
  },
};
function run(value, of) {
  let turns = null;
  const before = box.held;
  while (value instanceof of) turns = [turns];
  return [before, box.held, JSON.stringify(turns)].join();
}
console.log(run({}, kind));
