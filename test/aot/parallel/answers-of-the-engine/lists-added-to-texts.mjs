// What a list adds to a text: its elements joined, or what methods of its own answer. The elements of a written list are shared: their text is kept until the next collection.
const log = [];
class Pair {
  constructor(first) {
    this.first = first;
    this.second = 0;
  }
}
const written = () => ["a", 1, null, undefined, true, 2.5];
const makers = [
  i => Object.keys(new Pair(i)),
  () => ["celsius", "writes"],
  written,
  i => [i, , i],
  () => [],
  i => [[i, [2]], []],
  i => [{ toString: () => (log.push("t" + i), "T") }, i],
  i => Object.assign(["x", "y"], { toString: () => "own" + i }),
  i => Object.assign(["x", "y"], { valueOf: () => i + 1 }),
  i => Object.assign(["x", "y"], { [Symbol.toPrimitive]: hint => hint + i }),
  i => Object.assign(["x", "y"], { join: () => "joined" + i }),
  i => class List extends Array { toString() { return "heir" + i + this.length; } }.of(1, 2),
  i => Object.setPrototypeOf(["p", "q"], { toString: () => "proto" + i }),
  i => { const list = ["c"]; list.push(list, i); return list; },
  () => [Symbol("s")],
  i => ["日" + i, "b"],
  () => [10n ** 20n, -0, NaN],
];
const uses = [
  list => " " + list,
  list => list + "!",
  list => 1 + list,
  list => list + 2.5,
  list => list + list,
  list => list + null,
  list => undefined + list,
  list => list + { valueOf: () => (log.push("v"), 7) },
  list => ({ toString: () => (log.push("o"), "O") }) + list,
  list => Symbol("q") + list,
  list => 5n + list,
  list => { let text = "s"; text += list; text += list; return text; },
  list => `${list}`,
  list => String(list),
  list => list.join(),
  list => list < "b",
];
for (const make of makers)
  for (const use of uses) {
    const seen = [];
    for (let i = 0; i < 3; i++) {
      try {
        seen.push(use(make(i)));
      } catch (error) {
        seen.push(error.name);
      }
    }
    console.log(seen.join(" | "));
  }
const shared = [];
for (let i = 0; i < 4; i++) {
  const list = written();
  shared.push("" + list);
  if (i === 1) list[0] = "changed";
  if (i === 2) list.push("more");
  shared.push("" + list, "" + written());
  if (i === 0) Bun.gc(true);
}
console.log(shared.join(" | "), log.join());
