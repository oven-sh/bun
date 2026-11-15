// Classes below Map and Array with generator methods, walked by for of
class Scores extends Map {
  *above(limit) {
    for (const [name, score] of this) if (score > limit) yield name;
  }
  sum() {
    let total = 0;
    for (const score of this.values()) total += score;
    return total;
  }
}
class Pairs extends Array {
  *pairs() {
    for (let i = 1; i < this.length; i++) yield [this[i - 1], this[i]];
  }
}
function run(a, b, c) {
  const scores = new Scores([["x", a], ["y", b], ["z", c]]);
  const list = Pairs.of(a, b, c);
  const out = [];
  for (const name of scores.above(b - 1)) out.push(name);
  for (const [left, right] of list.pairs()) out.push(right - left);
  return out.join() + " " + scores.sum() + " " + list.map(n => n * 2).length + (list.filter(n => n === a) instanceof Pairs);
}
console.log(run(1, 2, 3));
console.log(run(30, 20, 10));
console.log(run(0, 0, 0));
