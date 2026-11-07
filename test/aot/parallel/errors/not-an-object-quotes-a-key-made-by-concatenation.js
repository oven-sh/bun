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
  value => value[Symbol.iterator],
  value => value[[Symbol.iterator][0]],
  value => value[Symbol("mine")],
  value => value[Symbol()],
  value => {
    value[[Symbol.iterator][0]] = 1;
  },
  value => value[missing.length + 0.5],
  value => value[missing.length > 1],
  value => value[missing[0]],
  value => value[missing[1]],
  value => value[10n],
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
