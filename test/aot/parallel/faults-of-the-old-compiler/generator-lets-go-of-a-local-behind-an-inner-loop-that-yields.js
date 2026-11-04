// A generator sets a local to null at the end of each round, behind an inner loop that yields and assigns a parameter; a for-of in another function steps it.
const n = Number(process.argv[2] ?? 20);
const list = ["a", "bb", "ccc"];
function* walk(total) {
  for (let round = 0; round < 3; round++) {
    let item = list[round];
    if (item.length > 99) return -1;
    yield total;
    while (total < (round + 1) * 1000) {
      total = total * 3 + item.length;
      yield 0;
    }
    item = null;
  }
  return total;
}
function all(g) {
  const out = [];
  for (const each of g) out.push(String(each));
  return out.join(" ");
}
console.log(all(walk(n + 21)));
