// The class below Int32Array declares it.
const show = (value: any): string =>
  Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : typeof value === "string" ? JSON.stringify(value) : String(value);
function sum(words: Int32Array, table: Int32Array, turns: number): number {
  let total = 0;
  for (let at = 0; at < turns; at++) total = (Math.imul(total, 31) + (words[table[at]!]! >>> 1)) | 0;
  return total;
}

class Words extends Int32Array {
  get undefined() { return 90; }
}
const plain = new Int32Array([10, 20, 30, 40]);
const words = new Words([10, 20, 30, 40]);
const table = new Int32Array([0, 3, 1]);
for (let round = 0; round < 3; round++) console.log(sum(plain, table, 5), sum(words, table, 3), sum(words, table, 5));
