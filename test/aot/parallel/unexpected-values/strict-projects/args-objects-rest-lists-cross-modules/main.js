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
/* Output:
this file is strict: false
sum 14227012
size(rest) 3
first(rest) 1
total(rest) 6
walked(rest) 6
mapped(rest) Array[2, 4, 6]
borrowedMap(rest) Array[2, 4, 6]
spread(rest) 3
applied(rest) 3
isList(rest) true
tag(rest) "[object Array]"
stored(rest) 100
grown(rest) 4
callee(rest) "undefined"
keys(rest) "0,1,2,length"
size(sloppyArguments) 3
first(sloppyArguments) 1
total(sloppyArguments) 6
walked(sloppyArguments) 6
mapped(sloppyArguments) threw TypeError
borrowedMap(sloppyArguments) Array[2, 4, 6]
spread(sloppyArguments) 3
applied(sloppyArguments) 3
isList(sloppyArguments) false
tag(sloppyArguments) "[object Arguments]"
stored(sloppyArguments) 100
grown(sloppyArguments) 3
callee(sloppyArguments) "function"
keys(sloppyArguments) "0,1,2,length,callee,Symbol(Symbol.iterator)"
size(strictArguments) 3
first(strictArguments) 1
total(strictArguments) 6
walked(strictArguments) 6
mapped(strictArguments) threw TypeError
borrowedMap(strictArguments) Array[2, 4, 6]
spread(strictArguments) 3
applied(strictArguments) 3
isList(strictArguments) false
tag(strictArguments) "[object Arguments]"
stored(strictArguments) 100
grown(strictArguments) 3
callee(strictArguments) threw TypeError
keys(strictArguments) "0,1,2,length,callee,Symbol(Symbol.iterator)"
aliased at first Array[Array[1, 2], 1]
aliased after a store from another module Array[100, Array[100, 2]]
aliased after a store to the parameter Array["written", Array["written", 2]]
aliased after the element was removed Array[undefined, Array["again", 2]]
withDefaults at first Array[Array[1, 2], 1]
withDefaults after a store from another module Array[100, Array[1, 2]]
withDefaults after a store to the parameter Array[100, Array["written", 2]]
withDefaults after the element was removed Array[undefined, Array["again", 2]]
*/
