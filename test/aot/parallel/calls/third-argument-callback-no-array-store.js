// The characters of a String object are read-only, also once it has properties of its own: in strict code the store throws a TypeError.
const got = [];
try {
  Array.prototype.forEach.call("abc", function (value, index, all) { for (let i = 0; i < 40; i++) all["p" + i] = 5; all[index] = 7; got.push(String(all)); });
} catch (error) {
  got.push(error.name + ": " + error.message);
}
Array.prototype.forEach.call([1, 2], function (value, index, all) { all[index] = 7; got.push(all.join("")); });
console.log(got.join(" "));
