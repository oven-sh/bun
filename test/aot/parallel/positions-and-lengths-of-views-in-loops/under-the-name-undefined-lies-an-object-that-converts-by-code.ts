// `words[table[at]] >>> 1` past the end of `table`: the read goes by the name "undefined". What lies there is an object whose valueOf counts.
const show = (value: any): string =>
  Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : typeof value === "string" ? JSON.stringify(value) : String(value);
function sum(words: Int32Array, table: Int32Array, turns: number): number {
  let total = 0;
  for (let at = 0; at < turns; at++) total = (Math.imul(total, 31) + (words[table[at]!]! >>> 1)) | 0;
  return total;
}

const words = new Int32Array([10, 20, 30, 40]);
const table = new Int32Array([0, 3, 1]);
console.log(sum(words, table, 3), sum(words, table, 5));
let converted = 0;
(words as any).undefined = { valueOf() { return ++converted * 4; } };
for (let round = 0; round < 3; round++) console.log(sum(words, table, 3), sum(words, table, 5), sum(words, table, 9));
console.log(converted);
