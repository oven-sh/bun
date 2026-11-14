// Maps and filters in loops whose callbacks make strings and compare them: they are copied, and no call is left.
// STATISTIC: CallbackChainsFused = 0
const letters = ["a", "b", "c"], words = ["x", "y", "x", "z"], mixed = [1, "1", 2];
let total = 0;
const said = [];
for (let k = 0; k < 60; k++) {
  total += letters.map((x, i) => x + i)[k % 3].length;
  total += words.filter((x, i) => x + "" !== "x" + (i % 2 ? "" : k)).length;
  const joined = words.map(x => x + x + k);
  total += joined[k % 4]?.length ?? 1;
  if (k % 20 === 7) said.push(letters.map((x, i) => x + i), joined, mixed.map((x, i) => x + i), words.filter(x => x !== "x"));
  if (k === 30) { letters.push("d"); delete words[1]; mixed[0] = null; }
}
console.log(total, JSON.stringify(said));
