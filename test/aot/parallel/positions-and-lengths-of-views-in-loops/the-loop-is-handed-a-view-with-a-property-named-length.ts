// `at < words.length` asks the object, and the reads ask the view.
const show = (value: any): string =>
  Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : typeof value === "string" ? JSON.stringify(value) : String(value);
function total(words: Int32Array): string {
  let sum = 0, turns = 0;
  for (let at = 0; at < words.length; at++) {
    sum = (sum + (words[at]! | 0)) | 0;
    turns++;
  }
  return sum + " " + turns;
}
const plain = Int32Array.from([5, 6, 7]);
const other = Object.defineProperty(Int32Array.from([1, 2, 3, 4]), "length", { value: 3 }) as Int32Array;
for (let round = 0; round < 3; round++) console.log(total(plain), total(other));
