// An entry re-exports what a CommonJS file holds: built-in functions, by name, by `export *` and as a namespace. They are read off the entry later and called.
export { map, kept as again } from "./named.cjs";
export * from "./starred.cjs";
export { default as whole } from "./whole.cjs";
export * as inner from "./inner.mjs";

setTimeout(async () => {
  const self = await import(Bun.main);
  const word = letters => letters.join("");
  console.log(Object.keys(self).sort().join());
  console.log(self[word(["m", "ap"])].call([1, 2], x => x + 1).join());
  console.log(self[word(["ag", "ain"])].deep.filter.call([1, 2], x => x > 1).join());
  console.log(self[word(["so", "me"])].call([1, 2], x => x > 1));
  console.log(self[word(["who", "le"])].every.call([1, 2], x => x > 1), self.whole());
  console.log(self[word(["in", "ner"])].held.find.call([1, 2], x => x > 1));
}, 0);
