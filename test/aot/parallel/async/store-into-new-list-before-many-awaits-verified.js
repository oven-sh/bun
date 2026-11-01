// Flags: --aot-check=verify-each-stage
const log = [];
function note(depth) {
  if (depth > 0) return note(depth - 1) + 1;
  log.push(depth);
  return 0;
}
async function later(value) {
  return value;
}
async function run(a) {
  const spare = { n: a };
  const list = [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }];
  let sum = note(a);
  list[a & 3] = spare;
  sum += await later(1);
  sum += await later(2);
  sum += await later(3);
  sum += await later(4);
  sum += await later(5);
  sum += await later(6);
  sum += await later(7);
  sum += await later(8);
  sum += await later(9);
  sum += await later(10);
  sum += await later(11);
  sum += await later(12);
  sum += await later(13);
  sum += await later(14);
  sum += await later(15);
  sum += await later(16);
  sum += await later(17);
  sum += await later(18);
  return sum + list[0].n + list[1].n + list[2].n + list[3].n;
}
const answers = [];
for (let i = 0; i < 6; i++) answers.push(await run(i));
console.log(answers.join(" "), log.length);
