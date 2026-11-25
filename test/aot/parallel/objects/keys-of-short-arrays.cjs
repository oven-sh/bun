// Keys that are arrays: the name of the string of a short array of small integers is kept.
const object = {};
const seen = new Map();
const keys = [[1, 0], [0, 1], [0, 0], [1, 2, 3], [0, 0, 0, 0], [65534, 1], [65535, 1], [-1, 2], [1, -0], [1], [], [1, 2, 3, 4, 5], [1, , 2], [1.5, 2], ["1", 0], [[1], [0]], [1, undefined], [1, null], [true, 2], [2147483647, 1], [1e21, 2], Object.freeze([3, 4])];
function set(key, value) {
  object[key] = value;
}
function get(key) {
  return object[key];
}
function rounds(count) {
  let text = "";
  for (let round = 0; round < count; round++) {
    for (let k = 0; k < keys.length; k++) {
      const key = keys[k];
      if (round % 2) set(key, round * 100 + k);
      text += String(get(key)) + ",";
      text += key in object ? "in " : "out ";
    }
  }
  return text;
}
console.log(rounds(4));
console.log(JSON.stringify(object));
let total = 0;
for (let i = 0; i < 2000; i++) {
  const pair = [i % 7, i % 11];
  object[pair] = (object[pair] ?? 0) + i;
  total += object[[i % 7, i % 11]];
}
console.log(total, Object.keys(object).length);
for (const [x, y] of [[3, 4], [300, 400], [65533, 65534], [4, 3]]) {
  const name = `${x},${y}`;
  object[name] = "named " + name;
  console.log(get([x, y]), get([y, x]));
}
class Pair extends Array {
  toString() {
    return "pair";
  }
}
const pair = new Pair(2);
pair[0] = 1;
pair[1] = 0;
set(pair, "of a subclass");
console.log(get(pair), get([1, 0]), object.pair);
const own = [1, 0];
own.toString = () => "own";
set(own, "of its own");
console.log(get(own), object.own, get([1, 0]));
const primitive = [0, 1];
primitive[Symbol.toPrimitive] = hint => hint;
set(primitive, "by hint");
console.log(get(primitive), object.string);
for (const base of [null, undefined, 5, "text", Symbol.iterator, [7, 8], () => 1]) {
  try {
    console.log(String(base[[1, 0]]));
  } catch (error) {
    console.log(error.name);
  }
}
