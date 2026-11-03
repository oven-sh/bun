// Array.isArray and the methods of arrays tell a String object from an array.
const got = [];
Array.prototype.forEach.call("abc", function (value, index, all) { got.push(typeof all.push + ":" + Array.isArray(all)); });
Array.prototype.forEach.call([1, 2], function (value, index, all) { got.push(typeof all.push + ":" + Array.isArray(all)); });
console.log(got.join(" "));
