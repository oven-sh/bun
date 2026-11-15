// A list that is made where it is added to a text is the text of its elements there, as long as the methods that convert lists are those of the engine.
class Pair {
  constructor(first) {
    this.first = first;
    this.second = 0;
  }
}
const text = "t" + process.argv.length;
let kept;
const uses = [
  i => " " + Object.keys(new Pair(i)),
  i => Object.keys(new Pair(i)) + text,
  i => text + ["a", i, null, undefined, true, 2.5] + text,
  () => "" + [],
  i => [i] + "",
  i => "x" + [[i], "n"],
  i => "x" + [, i],
  () => "x" + [Symbol("s")],
  i => "x" + (kept = ["k", i]),
  i => `${["u", i]}${text}`,
  (i, other) => "o" + [other, i],
  i => [10n, -0, i] + "n",
  i => ("l" + Object.keys({ a: i, b: 2 })).length,
  i => "s" + [...["a", "b"], i],
];
function run(round) {
  const seen = [];
  for (const use of uses)
    for (let i = 0; i < 3; i++) {
      try {
        seen.push(use(i, { toString: () => "other" + i }));
      } catch (error) {
        seen.push(error.name);
      }
    }
  console.log(round, seen.join("|"), kept.join());
}
run("as made");
Array.prototype.late = 1;
run("another name");
