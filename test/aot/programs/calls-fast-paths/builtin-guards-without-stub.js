// A variable that is predicted to hold a built-in is compared with the engine's function. The program says at its start which functions its guards compare with, so a guard is a load and a comparison: it does not ask a stub whether the function has been looked up yet.
// CALLS- kind TypedBuiltinCell
// CALLS- owns TypedBuiltinCell
var isArray = Array.isArray, hasOwnProperty = Object.prototype.hasOwnProperty, keys = Object.keys;
function kind(value) { return isArray(value) ? "array" : typeof value; }
function owns(object, key) { return hasOwnProperty.call(object, key); }
function names(object) { return keys(object).join(); }
var values = [[], {}, "s", 1, null, undefined, function () {}, new Proxy([], {})];
console.log(values.map(function (value) { return kind(value); }).join(), owns({ a: 1 }, "a"), owns({ a: 1 }, "b"), owns([1], 0), names({ a: 1, b: 2 }), names("xy"));
isArray = function (value) { return value === 1; };
hasOwnProperty = { call: function (object, key) { return key + "?"; } };
keys = function () { return ["mine"]; };
console.log(values.map(function (value) { return kind(value); }).join(), owns({ a: 1 }, "a"), names({ a: 1 }));
isArray = Array.isArray;
console.log(kind([]), kind({}));
