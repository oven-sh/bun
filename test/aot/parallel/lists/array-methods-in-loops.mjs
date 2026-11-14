// Array methods with a callback inside loops. Elements become nullish, holes appear, and a callback that reads a property off a nullish element throws as it would where nothing is copied.
// STATISTIC: CallbackChainsFused <= 2
const one = x => (Array.isArray(x) ? "[" + Array.from(x, (e, k) => (k in x ? one(e) : "_")) + "]" : Object.is(x, -0) ? "-0" : typeof x === "object" && x ? "{" + x.v + "}" : String(x));
class Item { constructor(k) { this.v = k; this.w = k * 1.5; this.on = k % 3 > 0; } }
const items = [1, 2, 3, 4, 5].map(k => new Item(k)), numbers = [5, 2, 9, 0, 7], words = ["a", "bb", "", "dddd"], holey = [4, 5, 6];
const said = [];
for (let round = 0; round < 10; round++) {
  const values = items.map(x => x.v), on = items.filter(x => x.on), some = items.some(x => x.w > round), every = items.every(x => x.v < 9), found = items.find(x => x.v === round), at = items.findIndex(x => x.v === round), sum = items.reduce((a, x) => a + x.w, 0);
  const doubled = numbers.map(x => x * 2), kept = numbers.filter(x => x > round), lengths = words.map(s => s.length), left = holey.map(x => x + 1);
  said.push([values, on, some, every, found, at, sum, doubled, kept, lengths, left].map(one).join(" "));
  if (round === 3) delete holey[1];
  if (round === 5) numbers[1] = -0;
  if (round === 7) words.length = 1;
}
const rare = [new Item(1), new Item(2), new Item(3)];
for (let round = 0; round < 8; round++) {
  let text = "";
  try { text += one(rare.map(x => x.v)); } catch (e) { text += "!" + e.constructor.name; }
  try { text += one(rare.filter(x => x.on)); } catch (e) { text += "!" + e.constructor.name; }
  try { text += one(rare.some(x => x.w > 100)); } catch (e) { text += "!" + e.constructor.name; }
  text += one(rare.filter(x => x != null)) + one(rare.map(x => (x ? x.v : -1)));
  said.push(text);
  if (round === 4) rare[1] = undefined;
  if (round === 5) rare[1] = null;
  if (round === 6) delete rare[1];
}
console.log(said.join("\n"));
