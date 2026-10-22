// One iterator of a map or a set is stepped by hand, by for-of, by a spread and by two nested loops in turn: each goes on where the one before stopped, as in plain Bun.
function firstTwo(iterator) { const seen = []; for (const item of iterator) { seen.push(item); if (seen.length === 2) break; } return seen.join(); }
function rest(iterator) { const seen = []; for (const item of iterator) seen.push(item); return seen.join(); }
const map = new Map([["a", 1], ["b", 2], ["c", 3], ["d", 4]]);
const set = new Set(["p", "q", "r", "s"]);
for (const [what, make] of [["map keys", () => map.keys()], ["map values", () => map.values()], ["set values", () => set.values()], ["map entries", () => map.entries()]]) {
  const one = make();
  console.log(what, "|", one.next().value + "", "|", rest(one), "|", rest(one), "|", one.next().done);
}
{
  const keys = map.keys();
  let first = "";
  for (const key of keys) { first = key; break; }
  console.log("after a break:", first, [...keys].join());
}
{
  const keys = map.keys();
  const first = keys.next().value;
  const spread = [...keys];
  const last = keys.next();
  console.log("by hand, spread, by hand:", first, spread.join(), last.done, last.value);
}
{
  const values = set.values();
  let count = 0;
  for (const value of values) { count++; if (value === "q") for (const inner of values) count += 10; }
  console.log("one iterator in two nested loops:", count);
}
{
  const keys = map.keys();
  for (let round = 0; round < 3; round++) { let seen = ""; for (const key of keys) seen += key; console.log("round", round, JSON.stringify(seen)); }
}
console.log(firstTwo(map.keys()), firstTwo(set.values()));
