// One deed. A loop is built twice; in its typed copy a test that fails while nothing of the turn was done begins the turn again in the other copy, and a test that answers the same in every turn is asked once in front.
// @ts-nocheck
function run(table, times) {
  let sum = 0;
  for (let i = 0; i < times; i++) sum = (table.handler(sum) + table.bias) | 0;
  return sum;
}
function main() {
  const first = { handler: (x) => x + 3, bias: 1 };
  const second = { handler: Math.abs, bias: 1 };
  const third = { handler: (x) => x + 3, bias: 1.5 };
  const fourth = { handler: (x) => x + 3, bias: "2" };
  globalThis.tables = [first, second, third, fourth];
  (0, eval)("1");
  console.log(run(first, 500), run(second, 500), run(third, 500), run(fourth, 5), run(first, 500));
}
main();
