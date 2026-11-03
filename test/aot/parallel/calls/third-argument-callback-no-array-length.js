// The String object has properties of its own by the time its length is read. The length is that of the string.
const got = [];
Array.prototype.forEach.call("abc", function (value, index, all) { for (let i = 0; i < 40; i++) all["p" + i] = 5; got.push(String(all[index]) + ":" + all.length); });
Array.prototype.forEach.call([1, 2], function (value, index, all) { got.push(all[index] + ":" + all.length); });
console.log(got.join(" "));
