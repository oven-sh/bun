// A variable that an object literal is stored into, read by key: every spelling of an enum, then the same variable holding what a reader would guess from the read.
var orAssign;
((E) => {
  E[E["A"] = 0] = "A";
  E[E["B"] = 1] = "B";
})(orAssign ||= {});
var orParenthesized;
(function (E) {
  E[E["A"] = 0] = "A";
})(orParenthesized || (orParenthesized = {}));
var nullish;
nullish ??= { 0: "zero" };
var filled;
filled ||= { A: 0, 0: "A", B: 1, 1: "B" };
var plain;
plain = {};
plain[0] = "first";

var thenArray;
thenArray = {};
thenArray = ["array"];
var thenString;
thenString = {};
thenString = "text";
var maybeLiteral = process.argv.length > 99 ? "unused" : undefined;
maybeLiteral ||= {};
maybeLiteral[0] = "stored";
var arrayFirst = [1];
arrayFirst ||= {};
var andAssign = "truthy";
andAssign &&= { 0: "replaced" };
var left = "text";
left ||= {};
function read(value, key) {
  return value[key];
}
function lengths(i) {
  return [orAssign[i].length, filled[i].length, thenArray[0].length, thenString[0].length];
}
console.log(orAssign[0], orAssign[1], orAssign.A, orParenthesized[0], nullish[0], filled[1], plain[0]);
console.log(thenArray[0], thenString[0], maybeLiteral[0], arrayFirst[0], andAssign[0], left[0]);
console.log(thenArray.length, thenString.length, arrayFirst.length, left.length, orAssign.length);
console.log(lengths(0), lengths(1));
console.log(read(orAssign, 1), read(thenArray, 0), read(thenString, 1));
