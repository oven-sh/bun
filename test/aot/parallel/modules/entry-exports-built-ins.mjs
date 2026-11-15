// An entry exports objects that hold built-in functions, and nothing in the program reads them by name. They are read off the entry later and called.
const { map } = Array.prototype;
export const copy = { map, nested: { list: [Array.prototype.filter, Array.prototype.some] } };
export const table = new Map([["every", Array.prototype.every]]);
export class Holder {
  static find = Array.prototype.find;
  reduce = Array.prototype.reduce;
}
export const holder = new Holder();
export function tool() {}
tool.findLast = Array.prototype.findLast;
export let late;
late = Object.assign(Object.create(null), { flatMap: Array.prototype.flatMap });

setTimeout(async () => {
  const self = await import(Bun.main);
  const word = letters => letters.join("");
  console.log(Object.keys(self).sort().join());
  console.log(self[word(["co", "py"])][word(["m", "ap"])].call([1, 2, 3], x => x * 2).join());
  const [filter, some] = self[word(["co", "py"])].nested.list;
  console.log(filter.call([1, 2, 3], x => x > 1).join(), some.call([1], x => x > 1));
  console.log(self[word(["ta", "ble"])].get("every").call([1, 2], x => x > 0));
  console.log(self[word(["Hol", "der"])].find.call([4, 5], x => x > 4));
  console.log(self[word(["hol", "der"])].reduce.call([1, 2, 3], (a, b) => a + b));
  console.log(self[word(["to", "ol"])].findLast.call([6, 7], x => x < 7));
  console.log(self[word(["la", "te"])].flatMap.call([1, 2], x => [x, x]).join());
}, 0);
