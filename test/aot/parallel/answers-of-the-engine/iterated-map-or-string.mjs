// A built-in iterates what is a map, a string or an object with an iterator of its own: only a map gives pairs.
class Item { constructor(n) { this.count = n; } }
const byKey = new Map([["map", new Map([[1, new Item(2)]])], ["text", "xyz"], ["box", { *[Symbol.iterator]() { yield new Item(5); yield "s"; } }], ["set", new Set([3, "four"])], ["params", new URLSearchParams("a=b&c=d")]]);
function lengths(key) {
  const found = [];
  new Set(byKey.get(key)).forEach((value) => found.push(value));
  let sum = "";
  for (const value of found) sum += " " + value.length;
  return sum;
}
const show = (value) => (value instanceof Item ? "Item" + value.count : Array.isArray(value) ? "[" + value.map(show) + "]" : typeof value + ":" + value);
const calls = [(x) => [...new Set(x)], (x) => Array.from(x), (x) => Array.from(new Set(x).values()), (x) => [...Iterator.from(x[Symbol.iterator]())], (x) => Object.fromEntries([...new Set(x)].map((v, i) => [i, v]))];
for (let turn = 0; turn < 2; turn++) {
  for (const key of byKey.keys()) {
    console.log(key + lengths(key));
    for (const call of calls) {
      let answer;
      try {
        answer = call(byKey.get(key));
        answer = Array.isArray(answer) ? answer.map(show).join() : Object.values(answer).map(show).join();
      } catch (error) {
        answer = error.constructor.name;
      }
      console.log(answer);
    }
  }
}
function letters(x) {
  let text = "";
  for (const value of new Set(x)) text += typeof value === "string" ? value.toUpperCase() : value[0];
  return text;
}
console.log(letters(byKey.get("map")), letters(byKey.get("text")), letters("ab"), letters(new Map([["k", 1]])));
