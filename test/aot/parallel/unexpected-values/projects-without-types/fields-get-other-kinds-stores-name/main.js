var model = require("./model");
var patch = require("./patch");
var patches = require("./patches.json");
var show = require("./show").show;

console.log("this file is strict:", (function () {
  return this === undefined;
})());

var methods = ["bump", "double", "title", "keep", "span"];
var sum = 0;
for (var i = 0; i < 2000; i++) {
  for (var kind in model) {
    var honest = model[kind]();
    sum += honest.bump() + honest.double() + honest.title() + honest.keep(i) + honest.span();
  }
}
console.log("sum", sum);

Object.keys(model).forEach(function (kind) {
  Object.keys(patch.ways).forEach(function (way) {
    Object.keys(patches).forEach(function (name) {
      var answers = methods.map(function (method) {
        var object = model[kind]();
        patch.ways[way](object, JSON.parse(JSON.stringify(patches[name])));
        try {
          return show(object[method](1));
        } catch (error) {
          return error.constructor.name;
        }
      });
      console.log(kind + " " + way + " " + name + ":", answers.join(" "));
    });
  });
});
