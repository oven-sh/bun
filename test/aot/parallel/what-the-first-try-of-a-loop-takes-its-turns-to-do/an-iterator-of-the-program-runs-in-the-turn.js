const box = { held: 0 };
const three = {
  [Symbol.iterator]() {
    let at = 0;
    return {
      next() {
        box.held = box.held + 5;
        at = at + 1;
        return { done: at === 4, value: at };
      },
      return() {
        box.held = box.held + 100;
        return {};
      },
    };
  },
};
function run(source, stopAt) {
  let last = null;
  const before = box.held;
  for (const value of source) {
    last = value;
    if (value === stopAt) break;
  }
  return [before, box.held, last].join();
}
console.log(run(three, 9), run(three, 2));
