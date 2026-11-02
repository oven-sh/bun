// The generic methods of Array.prototype on array-likes whose length is past the limit of arrays: the elements lie under names that are whole numbers and no array indexes. Each is read back by number and by text.
const arrayLike = { length: 2 ** 53 - 2, push: Array.prototype.push };
arrayLike.push("pushed");
const byNumber = arrayLike[9007199254740990];
const byText = arrayLike["9007199254740990"];
console.log(byNumber, byText, Object.keys(arrayLike).join(), "9007199254740990" in arrayLike, Object.hasOwn(arrayLike, "9007199254740990"));
const second = { length: 2 ** 32, unshift: Array.prototype.unshift, splice: Array.prototype.splice, 4294967295: "high" };
Array.prototype.push.call(second, "next");
const high = second["4294967296"];
console.log(high, second.length, second[4294967295]);
const third = { length: 4294967295, 4294967294: "last" };
const reversedHigh = Array.prototype.fill.call(third, "filled", 4294967294, 4294967295);
console.log(third["4294967294"], reversedHigh === third);
const fourth = { length: 4294967297, 4294967296: "beyond" };
console.log(Array.prototype.pop.call(fourth), fourth.length, "4294967296" in fourth, Array.prototype.at.call({ length: 4294967297, 4294967296: "at" }, -1), Array.prototype.lastIndexOf.call({ length: 4294967297, 4294967296: "sought" }, "sought"), Array.prototype.includes.call({ length: 4294967297, 4294967296: "sought" }, "sought", 4294967290));
