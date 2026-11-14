var consume = require("./consume");
var attempt = require("./show").attempt;

console.log("this file is strict:", (function () {
  return this === undefined;
})());

function load(name) {
  return require("./plugins/" + name + ".js");
}
function decoded(text) {
  return Buffer.from(text, "hex").toString();
}

var sum = 0;
for (var i = 0; i < 2000; i++) {
  var list = load("list").make();
  sum += consume.size(list) + consume.first(list) + consume.total(list) + consume.indexed(list) + consume.sorted(list)[0] + consume.each(list).length + consume.unpacked(list)[1];
}
console.log("sum", sum);

var names = "list like text set map typed generator number heir nothing list".split(" ");
names.forEach(function (name) {
  Object.keys(consume).forEach(function (use) {
    attempt(use + "(" + name + ")", function () {
      return consume[use](load(name).make());
    });
  });
});
attempt("a name that is decoded at run time", function () {
  return consume.total(load(decoded("736574")).make());
});
attempt("a plugin that is not there", function () {
  return load("absent").make();
});
