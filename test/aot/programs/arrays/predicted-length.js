// `Array(length)` where the length is only expected to be a number: an int32 is the length as it is: it is not made a double and an integer again. Any other value goes to the engine's function.
function holes(list, start) { return Array(Math.max(list.length - start, 0)).length; }
function made(length) { var array = new Array(length); return [array.length, 0 in array, Array.isArray(array)]; }
function attempt(f) { try { return JSON.stringify(f()); } catch (error) { return error.name + (error instanceof RangeError ? ": " + error.message : ""); } }
var list = [1, 2, 3, 4, 5];
for (var start of [0, 1, 5, 9, -1, 1.5, "1", "x", null, undefined, true, NaN, 2147483647, 4294967296, -0, 1n, { valueOf: function () { return 2; } }]) console.log(String(typeof start == "object" && start ? "object" : start), attempt(function () { return holes(list, start); }));
for (var length of [0, 1, 7, 3.0, 2.5, -1, NaN, "3", null, undefined, true, {}, [2], 4294967296]) console.log(String(length), attempt(function () { return made(length); }));
