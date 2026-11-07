// A turn lays the property that later turns find.
const show = (value: any): string =>
  Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : typeof value === "string" ? JSON.stringify(value) : String(value);
function sum(words: Int32Array, table: Int32Array, turns: number, lay: (at: number) => void): number {
  let total = 0;
  for (let at = 0; at < turns; at++) {
    lay(at);
    total = (Math.imul(total, 31) + (words[table[at]!]! >>> 1)) | 0;
  }
  return total;
}
const words = new Int32Array([10, 20, 30, 40]);
const table = new Int32Array([0, 3, 1]);
console.log(sum(words, table, 8, () => {}));
console.log(sum(words, table, 8, at => { if (at === 5) (words as any).undefined = 1000; }));
console.log(sum(words, table, 8, () => {}));
