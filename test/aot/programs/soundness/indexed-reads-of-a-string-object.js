// A String object has its characters as own properties under the indexes.
function kindOf(v) {
  return typeof v;
}
function quoted(v) {
  return typeof v === "string" ? '"' + v + '"' : "" + v;
}

const boxed = new String("abc");
const second = boxed[1];
console.log(second === undefined, typeof second, second + "!", second.length);
console.log(kindOf(boxed[0]), kindOf(Object("abc")[1]), kindOf(boxed[3]), kindOf(boxed["2"]));

const found = [];
for (let i = 0; i < boxed.length; i++) found.push(quoted(boxed[i]));
console.log(found.join());

console.log(1 in boxed, 3 in boxed, Object.hasOwn(boxed, 2), Object.keys(boxed).join(), JSON.stringify(Object.getOwnPropertyDescriptor(boxed, 0)));

// What the usual helpers do with `this`.
function each(callback) {
  const object = Object(this);
  for (let k = 0; k < object.length; k++) if (k in object) callback(object[k], k);
}
const seen = [];
each.call("xyz", (character, k) => seen.push(k + character.toUpperCase()));
console.log(seen.join());

try {
  boxed[0] = "z";
  console.log("stored", boxed[0]);
} catch (e) {
  console.log("threw " + e.name);
}
