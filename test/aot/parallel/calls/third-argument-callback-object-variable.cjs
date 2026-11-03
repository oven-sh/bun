// An array method borrowed by `.call` for a variable that holds a string, which also went through another borrowed method and into a function that compares it: the callback gets the String object.
function report(expected, actual) { console.log(expected === actual ? "as expected" : "got " + actual); }
var value;
var actual;
value = "abc";
try { actual = Array.prototype.pop.call(value); } catch (error) { actual = error + ""; }
report("abc", value);
actual = "";
Array.prototype.forEach.call(value, function (element, index, array) { actual += array[index].toUpperCase(); });
console.log(actual);
