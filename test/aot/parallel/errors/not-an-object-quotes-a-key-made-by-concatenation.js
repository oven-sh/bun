// Plain Bun and an executable quote different text, so this asks only that each quotes something.
const missing = [undefined, null];
const key = "k" + String(missing.length);
const longKey = "a very long key ".repeat(40) + String(missing.length);
const ways = [
  value => value[key],
  value => {
    value[key] = 1;
  },
  value => value[longKey],
  value => value["fl" + "at"],
  value => value[missing.length],
];
for (const value of missing) {
  for (const way of ways) {
    try {
      way(value);
      console.log("no throw");
    } catch (error) {
      console.log(error.name, error.message.startsWith(`${value} is not an object`), error.message.includes("evaluating"));
    }
  }
}
console.log(key, longKey.length);
