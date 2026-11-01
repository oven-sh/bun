var lists = require("./lists");
var values = require("./values");
var attempt = require("./show").attempt;
var show = require("./show").show;

console.log("this file is strict:", (function () {
  return this === undefined;
})());

var operands = { has: "c", glued: ["e"], contains: "c" };

function table(round) {
  Object.keys(values).forEach(function (maker) {
    Object.keys(lists).forEach(function (use) {
      var value = values[maker]();
      attempt(round + " " + use + "(" + maker + ")", function () {
        return show(lists[use](value, operands[use])) + " leaves " + show(value);
      });
    });
  });
}

var lengths = 0;
for (var i = 0; i < 2000; i++) {
  var honest = values.honest();
  lengths += lists.last(honest).length + lists.part(honest).length + lists.glued(honest, ["e"]).length + lists.size(honest) + lists.spread(honest).length + lists.joined(honest).length;
  lengths += lists.has(honest, "c") + lists.contains(honest, "q") + lists.fromTheEnd(honest).length + lists.stored(honest).length + lists.shortened(honest);
}
console.log("lengths", lengths);
attempt("seen last(text)", function () {
  return lists.last("abcd");
});
attempt("seen part(text)", function () {
  return lists.part("abcd");
});
table("after 2000 arrays");
attempt("honest again", function () {
  return lists.glued(values.honest(), ["e"]);
});
