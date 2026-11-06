var collect = require("./collect");
var attempt = require("./show").attempt;
var work = require("./work");

console.log("this file is strict:", (function () {
  return this === undefined;
})());

var sum = 0;
for (var i = 0; i < 2000; i++) {
  var list = collect.rest(i, 2, 3);
  sum += work.size(list) + work.first(list) + work.total(list) + work.walked(list) + work.mapped(list)[0] + work.spread(list) + work.applied(list) + work.stored(list) + work.grown(list);
}
console.log("sum", sum);
["rest", "sloppyArguments", "strictArguments"].forEach(function (maker) {
  Object.keys(work).forEach(function (use) {
    attempt(use + "(" + maker + ")", function () {
      return work[use](collect[maker](1, 2, 3));
    });
  });
});
["aliased", "withDefaults"].forEach(function (maker) {
  var held = collect[maker](1, 2);
  attempt(maker + " at first", function () { return [held.read(), held.operands[0]]; });
  attempt(maker + " after a store from another module", function () { return [work.stored(held.operands), held.read()]; });
  held.write("written");
  attempt(maker + " after a store to the parameter", function () { return [work.first(held.operands), held.read()]; });
  attempt(maker + " after the element was removed", function () { delete held.operands[0]; held.write("again"); return [work.first(held.operands), held.read()]; });
});
