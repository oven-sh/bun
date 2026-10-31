// Evaluated text reduces array like objects made by compiled code.
// Flags: --aot-testing=FailPredictions
function toObject(array) { var o = {}; for (var i in array) o[i] = array[i]; o.length = array.length; o.reduce = Array.prototype.reduce; return o; }
function toUnorderedObject(array) { var o = {}; var props = []; for (var i in array) props.push(i); for (var i = props.length - 1; i >= 0; i--) o[props[i]] = array[props[i]]; o.length = array.length; o.reduce = Array.prototype.reduce; return o; }
var callCount = 0;
console.log(eval("[1,2,3].reduce(function(a,b){ return a + b; })"));
console.log(eval("toUnorderedObject([0,1,2,3]).reduce(function(a,b){ return a + b; }, 4)"));
console.log(eval("toUnorderedObject([1,2,3]).reduce(function(a,b){ return a + b; }, 4)"));
console.log(eval("toObject([1, 2, 3, 4]).reduce(function(a,b, i, thisObj){ thisObj.length++; callCount++; return a + b; }, 0); callCount"));
