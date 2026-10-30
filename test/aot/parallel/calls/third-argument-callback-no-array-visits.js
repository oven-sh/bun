// One method visits a string here and an array there. What the first callback gets is a String object: neither the string nor an array.
const got = [];
Array.prototype.forEach.call("abc", function (value, index, all) { got.push(typeof all + ":" + all[index] + ":" + (all instanceof String)); });
Array.prototype.forEach.call([1, 2], function (value, index, all) { got.push(all.length); });
console.log(got.join(" "));
