const answers = [0, 1, -1, 2.5, NaN, -0, "", "0", null, undefined, true, 0n, 7n, {}, 2147483647, -2147483648];
const table = { compare(a, b) { return a - b; }, pick(i) { return answers[i % answers.length]; } };
const names = ["compare", "compare", "compare", "pick"];
function signs(k) {
  let below = 0, above = 0, same = 0;
  for (let i = 0; i < k; i++) {
    const name = names[(i >> 3) & 3];
    const c = name === "pick" ? table[name](i) : table[name](i % 3, 1);
    if (!c) {
      same++;
      continue;
    }
    if (c < 0) below++;
    else above++;
  }
  return below + " " + above + " " + same;
}
class Counter {
  counts = {};
  add(key) {
    this.counts[key] = (this.counts[key] || 0) + 1;
  }
}
function count(k) {
  const counter = new Counter();
  const keys = ["a", "b", "c", "d"];
  counter.counts.c = "x";
  counter.counts.d = 0.5;
  for (let i = 0; i < k; i++) counter.add(keys[i & 3]);
  return JSON.stringify(counter.counts).slice(0, 60);
}
console.log(signs(4000), signs(50), count(40));
