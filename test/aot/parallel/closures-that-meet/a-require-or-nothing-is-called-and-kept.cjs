function run(load, box) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const got = load("node:path");
  box.last = load;
  return typeof got.join === "function" ? 1 + work : 100;
}
const first = { last: undefined, tag: 1 };
const second = { last: undefined, tag: 2 };
let total = 0, missed = 0;
for (let turn = 0; turn < 300; turn++) {
  try { total += run(turn % 50 === 49 ? undefined : require, turn & 1 ? first : second); }
  catch (error) { missed += error.name === "TypeError" ? 1 : 100; }
}
console.log(total, missed, first.last === require, second.last === require);
