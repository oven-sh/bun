// An array method borrowed for a string hands its callback the String OBJECT made from the receiver, never the string itself.
let seen = "";
Reflect.apply(Array.prototype.forEach, "abc", [function (value, index, array) { seen += typeof array + ":" + array[index] + " "; }]);
console.log(seen);

seen = "";
Reflect.apply(Array.prototype.map, "abc", [function (value, index, array) { seen += array[index]; }]);
console.log(seen);
