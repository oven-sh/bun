// A generator sets one parameter to undefined behind an inner loop that yields and assigns the other; a for-of in another function steps it.
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
function all(g) {
  const out = [];
  for (const each of g) out.push(String(each));
  return out.join(" ");
}
console.log(all(walk(n + 21, { extra: 5 })));
