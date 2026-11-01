// Evaluated text creates a field of a compiled object that holds indexes.
function indexed(array, fills, v) { var o = {}; for (var i in array) o[i] = array[i]; if (fills) o.length = v; return o; }
console.log(indexed([1], true, 1).length, indexed([1], true, "x").length);
console.log(eval("var n = 0; for (var i = 0; i < 9; i++) { var o = indexed([1, 2, 3, 4], false); o.length = 4; n += o.length; } n"));
