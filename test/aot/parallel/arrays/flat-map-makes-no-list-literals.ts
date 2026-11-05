// A flatMap in a loop whose callback returns short list literals allocates its result and nothing else: the literals are never made.
// COUNT: cells <= 7000
const numbers = [1, 2, 3, 4, 5, 6, 7, 8];
const texts = ["a", "b", "c", "d"];
function run(rounds: number): number {
  let total = 0;
  for (let round = 0; round < rounds; round++) {
    total += numbers.flatMap(x => [x, x + 1]).length;
    total += numbers.flatMap(x => (x & 1 ? [x] : [])).length;
    total += texts.flatMap(w => [w, w, w]).length;
  }
  return total;
}
console.log(run(1000));
