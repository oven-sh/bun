// A loop reads `done` and `value` off what next() answers.
function R() {}
R.done = false;
R.value = 5;
let turns = 0;
const it = {
  [Symbol.iterator]() {
    return this;
  },
  next() {
    if (turns++) R.done = true;
    return R;
  },
};
console.log([...it].join());
