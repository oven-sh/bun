var lazy = require("./lazy");
var attempt = require("./show").attempt;

console.log("this file is strict:", (function () {
  return this === undefined;
})());

function size() {
  return lazy.list.length;
}
function sizeOfOnce() {
  return lazy.once.length;
}
function helped() {
  return lazy.helper();
}
function storedOverFixed() {
  lazy.fixed = 2;
  return lazy.fixed;
}
function storedOverGetter() {
  lazy.list = "stored";
  return typeof lazy.list;
}
for (var round = 0; round < 6; round++) attempt("size, round " + round, size);
for (round = 0; round < 3; round++) attempt("size of once, round " + round, sizeOfOnce);
attempt("helper", helped);
attempt("store over a fixed member", storedOverFixed);
attempt("store over a getter", storedOverGetter);
attempt("a getter that throws", function () { return lazy.throwing; });
attempt("keys", function () { return Object.keys(lazy).join(); });
attempt("unpacked", function () {
  var { list, once, fixed } = lazy;
  return [list, once, fixed];
});
console.log("reads", lazy.reads.join(", "));
