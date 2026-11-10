const box = { held: 1, text: "" };
const number = {
  valueOf() {
    box.held = box.held + 1;
    return box.held;
  },
};
const text = {
  toString() {
    box.text = box.text + "t";
    return box.text;
  },
};
function run(n, t) {
  let sum = 0,
    all = "";
  const before = box.held;
  while (n < 5) {
    sum = sum + n;
    all = all + t;
  }
  return [before, box.held, sum, all, box.text].join();
}
console.log(run(number, text));
