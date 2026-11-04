const { attempt } = require("./show.cjs");
const uses = require("./uses.cjs");
const point = require("./point.mjs");

console.log("this file is strict:", (function () {
  return this === undefined;
})());

let checksum = 0;
for (let i = 0; i < 2000; i++) {
  for (const name in uses) {
    const answer = uses[name]({ x: i, y: 2 });
    checksum += typeof answer === "number" ? answer : 1;
  }
}
console.log("checksum", checksum);

for (const name in uses) attempt(name + "(namespace)", () => uses[name](point));
point.move(5);
for (const name of ["sum", "spread", "written", "unpacked"]) attempt(name + "(namespace after move)", () => uses[name](point));
for (const name in uses) attempt(name + "(plain again)", () => uses[name]({ x: 1, y: 2 }));
attempt("typeof move", () => typeof point.move);
attempt("the same object each time", () => require("./point.mjs") === point);
/* Output:
this file is strict: false
checksum 2079000
sum(namespace) 3
keys(namespace) Array["move", "x", "y"]
everyKey(namespace) Array["move", "x", "y", "Symbol(Symbol.toStringTag)"]
walked(namespace) Array["move=function", "x=number", "y=number"]
stored(namespace) 1
storedStrictly(namespace) threw TypeError
added(namespace) false
addedStrictly(namespace) threw TypeError
removed(namespace) false
removedStrictly(namespace) threw TypeError
copied(namespace) Object{move: function move, x: 1, y: 2}
spread(namespace) Object{move: function move, x: 1, y: 2}
written(namespace) "{\"x\":1,\"y\":2}"
asked(namespace) threw TypeError
glued(namespace) threw TypeError
tagged(namespace) "[object Module]"
described(namespace) Array["number", "undefined", true, true, false]
redefined(namespace) false
parent(namespace) false
unpacked(namespace) Array[1, 2, "default"]
absent(namespace) Array[undefined, false, true]
sum(namespace after move) 13
spread(namespace after move) Object{move: function move, x: 6, y: 7}
written(namespace after move) "{\"x\":6,\"y\":7}"
unpacked(namespace after move) Array[6, 7, "default"]
sum(plain again) 3
keys(plain again) Array["x", "y"]
everyKey(plain again) Array["x", "y"]
walked(plain again) Array["x=number", "y=number"]
stored(plain again) 10
storedStrictly(plain again) 10
added(plain again) true
addedStrictly(plain again) true
removed(plain again) true
removedStrictly(plain again) true
copied(plain again) Object{x: 1, y: 2}
spread(plain again) Object{x: 1, y: 2}
written(plain again) "{\"x\":1,\"y\":2}"
asked(plain again) true
glued(plain again) "[object Object]"
tagged(plain again) "[object Object]"
described(plain again) Array["number", "undefined", true, true, true]
redefined(plain again) true
parent(plain again) true
unpacked(plain again) Array[1, 2, "default"]
absent(plain again) Array[undefined, false, false]
typeof move "function"
the same object each time true
*/
