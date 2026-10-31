const shared = [];
function disturb(depth) {
  if (depth > 0) return disturb(depth - 1);
  if (shared.length) shared[shared.length - 1].length = 0;
  return 0;
}
async function later(value) {
  return value;
}
async function run(n) {
  let previous = [{ n: 0 }];
  let sum = 0;
  for (let round = 0; round < n; round++) {
    shared.push(previous);
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
    const next = [{ n: round }];
    const first = previous[0];
    disturb(round & 1);
    const again = previous[0];
    sum += (first ? 1000 : 0) + (again ? 100000 : 0) + next.length;
    previous = next;
  }
  return sum;
}
console.log(await run(1), await run(2), await run(5));
