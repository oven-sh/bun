// Built-ins applied by native code: parseInt, Math.max, Number, String, Boolean, BigInt and Symbol.for are handed to map, reduce and filter, which pass them the index and the array behind the element.
const texts = ["10", "10", "10", "10"];
const results: unknown[] = [
  texts.map(parseInt),
  [1, 5, 3].reduce(Math.max as any),
  [1, 5, 3].reduce(Math.min as any, 9),
  texts.map(Number),
  [1, "a", null, undefined, [2]].map(String),
  [0, 1, "", "a", null].filter(Boolean).length,
  [1, 2].map(BigInt as any).map(one => typeof one),
  ["a", "a"].map(Symbol.for as any).every((one, index, all) => one === all[0]),
  ["1.5", "2.5"].map(parseFloat),
  [65, 66].map(String.fromCharCode as any).map((one: any) => one.length),
];
console.log(results.map(one => String(one)).join(" "));
