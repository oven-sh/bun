// The text that stays is read once in front of the loop; the others are short, long, empty, ropes, of two bytes, outside ASCII, hold zeros, or differ in case alone.
class Name {
  constructor(value) {
    this.value = value;
  }
  compareTo(other) {
    return this.value.localeCompare(other.value);
  }
}
class Place {
  constructor(value) {
    this.value = value;
  }
  compareTo(other) {
    return this.value < other.value ? -1 : this.value > other.value ? 1 : 0;
  }
}
const letters = ["a", "A", "b", "B", "z", "Z", "0", "9", "_", "-", " ", "~", "é", "\u0000", "\u007f", "ß", "·", "l", "L", "\t", "Ā", "́"];
let seed = 5;
const random = n => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
const words = [""];
for (let length = 1; length <= 11; length++)
  for (let i = 0; i < 26; i++) {
    let word = "fooBar0123z".slice(0, random(length + 1));
    while (word.length < length) word += letters[random(i % 3 ? 8 : letters.length)];
    words.push(word);
    if (i % 5 === 0) words.push(word + letters[random(letters.length)], (word + "x").slice(0, -1), ("y" + word).slice(1));
  }
function compare(a, b) {
  return a.compareTo(b);
}
function first(list, key) {
  let left = 0, right = list.length;
  while (left < right) {
    const middle = (left + right) >> 1;
    if (key.compareTo(list[middle]) > 0) left = middle + 1;
    else right = middle;
  }
  return left;
}
function find(node, key) {
  let depth = 0;
  for (let current = node; current; ) {
    const order = compare(key, current.key);
    if (!order) return depth;
    depth++;
    if (order < 0) current = current.left;
    else current = current.right;
  }
  return -1 - depth;
}
function insert(tree, key) {
  let parent = null, x = tree.root;
  while (x) {
    parent = x;
    const order = key.compareTo(x.key);
    if (order < 0) x = x.left;
    else if (order > 0) x = x.right;
    else return false;
  }
  const z = { key, left: null, right: null };
  if (!parent) tree.root = z;
  else if (key.compareTo(parent.key) < 0) parent.left = z;
  else parent.right = z;
  return true;
}
let sum = 0;
function orders(left) {
  for (const right of words) sum = (sum * 31 + left.localeCompare(right)) | 0;
}
for (let round = 0; round < 2; round++) for (const word of words) orders(word);
const collator = new Intl.Collator();
let wrong = 0;
for (let i = 0; i < words.length; i += 3)
  for (let j = 0; j < words.length; j += 5) {
    const expected = collator.compare(words[i], words[j]);
    let order = 0;
    for (const right of [words[j], words[j]]) order = words[i].localeCompare(right);
    if (order !== expected) wrong++;
  }
const names = { root: null }, places = { root: null };
let added = 0, found = 0;
for (const word of words) added += +insert(names, new Name(word)) + +insert(places, new Place(word.length * 7 + word.charCodeAt(0)));
for (const word of words) found = (found * 31 + find(names.root, new Name(word)) + find(places.root, new Place(word.length * 7 + word.charCodeAt(0)))) | 0;
for (const odd of [Infinity, -1, 0.5, NaN]) found = (found * 31 + find(places.root, new Place(odd))) | 0;
const sorted = words.map(word => new Name(word)).sort((a, b) => a.compareTo(b));
let places2 = 0;
for (const word of words) places2 = (places2 * 31 + first(sorted, new Name(word))) | 0;
let thrown = "";
try {
  find(names.root, undefined);
} catch (error) {
  thrown += error.constructor.name;
}
try {
  insert(names, { compareTo: other => other.value.length - 4 });
  find(names.root, { compareTo: other => NaN });
} catch (error) {
  thrown += error.constructor.name;
}
console.log(words.length, sum, wrong, added, found, places2, thrown);
