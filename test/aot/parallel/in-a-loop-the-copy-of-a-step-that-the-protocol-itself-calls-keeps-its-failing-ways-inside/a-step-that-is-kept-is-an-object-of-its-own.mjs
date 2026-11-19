// What next() hands back is kept, compared and written on: each step is an object of its own, whichever way made it.
function steps(limit) {
  let at = 0;
  return { next() { return at < limit ? { value: at++, done: false } : { value: undefined, done: true }; } };
}
const kept = [];
let same = 0;
for (const limit of [3, "2", 2n, 0, 1.5]) {
  const walk = steps(limit);
  let before;
  for (let turn = 0; turn < 5; turn++) {
    const step = walk.next();
    if (step === before) same++;
    step.turn = turn;
    if (turn & 1) kept.push(step);
    before = step;
  }
}
console.log(same, kept.length, kept.map(step => [String(step.value), step.done, step.turn, Object.keys(step).join("")].join("/")).join(" "), new Set(kept).size);
