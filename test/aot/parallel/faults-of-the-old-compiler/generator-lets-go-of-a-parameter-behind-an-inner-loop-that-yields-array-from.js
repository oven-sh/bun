// A generator sets one parameter to undefined behind an inner loop that yields and assigns the other; Array.from at the top level steps it.
const n = Number(process.argv[2] ?? 20);
function* walk(total, first) {
  for (let round = 0; round < 3; round++) {
    yield total;
    while (total < (round + 1) * 1000) {
      total = total * 3 + (first ? first.extra : 0);
      yield 0;
    }
    first = undefined;
  }
  return total;
}
console.log(Array.from(walk(n + 21, { extra: 5 })).map(String).join(" "));
