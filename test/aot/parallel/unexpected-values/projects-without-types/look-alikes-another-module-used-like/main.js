var made = require("./made");
var show = require("./show").show;
var uses = require("./uses");

console.log("this file is strict:", (function () {
  return this === undefined;
})());

var total = 0;
for (var i = 0; i < 2000; i++) for (var name in uses) total += String(uses[name]("abc")).length;
console.log("total", total);
Object.keys(made.makers).forEach(function (maker) {
  Object.keys(uses).forEach(function (use) {
    made.log.length = 0;
    var said;
    try {
      said = show(uses[use](made.makers[maker]()));
    } catch (error) {
      said = "threw " + error.constructor.name;
    }
    console.log(use + "(" + maker + ")", said, made.log.length ? "after " + made.log.join(", ") : "");
  });
});
