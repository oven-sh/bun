// A function makes a closure at every call and hands it as the second argument to a function out of a table. Some of those have no
// parameter for it, some call it, some keep it, some find it in `arguments` or in a rest parameter, and some wait before they use it.
// COUNT: cells <= 82000
const kept = [];
const table = [
  a => a + 1,
  (a, f) => f(a),
  (a, f) => {
    kept.push(f);
    return a;
  },
  function (a) {
    return arguments.length > 1 ? arguments[1](a) : -1;
  },
  function (a) {
    kept.push(arguments[1]);
    return a;
  },
  async a => a * 2,
  async (a, f) => {
    await null;
    return f(a);
  },
  (a, ...rest) => rest[0](a),
  () => 7,
  async () => {
    await null;
    return 9;
  },
];

function run(turn) {
  let local = turn * 3;
  const result = table[turn % table.length](turn, x => x + local++);
  return typeof result === "number" ? result + local : result.then(value => value + local);
}

let sum = 0;
for (let turn = 0; turn < 30000; turn++) sum += await run(turn);
console.log(sum, kept.length);

Bun.gc(true);
let later = 0;
for (let index = 0; index < kept.length; index += 7) later += kept[index](index) + kept[index](1);
console.log(later, new Set(kept).size === kept.length);
