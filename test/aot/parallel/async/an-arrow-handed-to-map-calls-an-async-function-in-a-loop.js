async function load(item) { return item * 2; }
async function run(lists) {
  let total = 0;
  for (const list of lists) {
    const made = await Promise.all(list.map(item => load(item)));
    total += made.length + made[0];
  }
  return total;
}
for (let round = 0; round < 3; round++) console.log([1, 2].map(value => load(value)).length);
console.log(await run([[1, 2], [3], [4, 5, 6]]));
