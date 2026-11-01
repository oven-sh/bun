// Flags: --aot-check=verify-each-stage
async function later(value) {
  return value;
}
async function run(n) {
  const total = Array();
  const added = Array(n);
  for (let k = 0; k < n; k++) {
    total[k] = k;
    added[k] = k * 0.5;
  }
  let sum = 0;
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
  let k = 0;
  do {
    total[k] = total[k] + added[k];
  } while (++k < n);
  return sum + total.join(",");
}
const answers = [];
for (let i = 1; i < 6; i++) answers.push(await run(i));
console.log(answers.join(" "));
