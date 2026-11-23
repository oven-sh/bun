var collection = require("collection");
var attempt = require("./show").attempt;
var show = require("./show").show;
var work = require("./work");

console.log("this file is strict:", (function () {
  return this === undefined;
})());

var makers = {
  list: function () { return ["a", "b", "c"]; },
  collection: function () { return new collection.Collection("a", "b", "c"); },
  loud: function () { return new collection.Loud("a", "b", "c"); },
  stack: function () { return new collection.Stack("a", "b", "c"); },
  stackWithoutNew: function () { return collection.Stack("a", "b", "c"); },
};

var sum = 0;
for (var i = 0; i < 2000; i++) {
  var list = makers.list();
  sum += work.pushed(list) + work.popped(list).length + work.mapped(list).length + work.found(list) + work.size(list) + work.third(list).length + work.walked(list).length + work.glued(list) + work.written(list).length;
}
console.log("sum", sum);

Object.keys(makers).forEach(function (maker) {
  Object.keys(work).forEach(function (use) {
    var value = makers[maker]();
    attempt(use + "(" + maker + ")", function () {
      return show(work[use](value)) + " leaves " + show(value);
    });
  });
});
