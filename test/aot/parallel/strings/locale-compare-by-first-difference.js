// The first characters that differ decide, wherever they stand; weights, lengths, ropes and characters outside ASCII are asked as before.
const words = [];
const letters = ["a", "A", "b", "B", "z", "0", "9", "_", "-", " ", "~", "é", "\u0000", "ß", "aa"];
let seed = 7;
const random = n => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
for (const length of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 15, 16, 17, 23])
  for (let i = 0; i < 24; i++) {
    let common = "fooBarBaz0123456789abcdef".slice(0, random(length + 1)), word = common;
    while (word.length < length) word += letters[random(letters.length)];
    words.push(word);
    if (i % 4 === 0) words.push(word + letters[random(letters.length)]);
    if (i % 6 === 0) words.push(word.slice(0, -1) + letters[random(5)]);
  }
class Key {
  constructor(value) {
    this.value = value;
  }
  compareTo(other) {
    return this.value.localeCompare(other.value);
  }
}
const keys = words.map(word => new Key(word));
const collator = new Intl.Collator();
let sum = 0, wrong = 0;
for (let i = 0; i < keys.length; i++)
  for (let j = 0; j < keys.length; j++) {
    const order = keys[i].compareTo(keys[j]);
    sum = (sum * 31 + order + 1) | 0;
    if ((i * 7 + j) % 13 === 0 && order !== collator.compare(words[i], words[j])) wrong++;
    if (order !== -keys[j].compareTo(keys[i])) wrong++;
  }
let boxed = 0;
for (const left of words) for (const right of [words[3], "foo", "", "fooBar01"]) boxed = (boxed * 31 + [left][0].localeCompare(right)) | 0;
const sorted = words.slice().sort((x, y) => x.localeCompare(y));
console.log(words.length, sum, wrong, boxed, sorted.length, sorted.slice(0, 40).map(w => JSON.stringify(w)).join(), sorted[sorted.length - 1]);
