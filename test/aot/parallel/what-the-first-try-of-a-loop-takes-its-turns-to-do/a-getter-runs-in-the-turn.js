const seen = [];
const box = { held: 1 };
const holder = {
  get next() {
    box.held = box.held + 10;
    seen.push(box.held);
    return seen.length === 3 ? null : this;
  },
};
function run(start) {
  let at = start;
  const before = box.held;
  while (at !== null) at = at.next;
  return [before, box.held, seen.join("|")].join();
}
console.log(run(holder));
