// `pattern.test(value)` and `pattern.exec(value)` in a loop, where nothing says that the value is a string: the stub that tests the receiver and the argument is called there too, not the engine's function.
// IR= 1 countPlain Call .* speculated method 8
// IR= 1 firstWords Call .* speculated method 7
var isPlain = /^\w*$/, word = /\w+/;
function countPlain(values) {
  var count = 0;
  for (var i = 0; i < values.length; i++) if (isPlain.test(values[i])) count++;
  return count;
}
function firstWords(values) {
  var found = [];
  for (var i = 0; i < values.length; i++) { var match = word.exec(values[i]); found.push(match && match[0]); }
  return found;
}
var values = ["a", "a.b", "", 12, null, undefined, { toString: function () { return "x y"; } }, ["q"], true, "é", -0];
console.log(countPlain(values), JSON.stringify(firstWords(values)), RegExp.lastMatch);
isPlain.test = function (value) { return value === "a.b"; };
console.log(countPlain(values));
isPlain = { test: function (value) { return typeof value == "number"; } };
word = { exec: function (value) { return [typeof value]; } };
console.log(countPlain(values), JSON.stringify(firstWords(values)));
