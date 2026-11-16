// The same with var, where all closures share the last value
function make(list) {
  var calls = [];
  for (var i = 0; i < list.length; i++) {
    for (var k = 0; k < 2; k++) {
      var kept = list[i];
      calls.push(function (add) { return [i, k, kept, (kept = kept + add)].join("/"); });
    }
  }
  var out = [];
  for (i = 0; i < calls.length; i++) out.push(calls[i](i));
  return out.join(" ");
}
console.log(make([1, 2]));
console.log(make(["a", 0.5, null]));
console.log(make([]) + "|", make([true]));
