// An untyped package and a program of it (texts): colors by a table of expressions, each with its own reader of the groups
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
['#f0a', '#F0A8', '#336699', '#33669980', 'rgb(1, 2, 3)', 'rgb(10% 20% 30% / 50%)', 'rgba(255,128,0,.25)', 'hsl(120, 100%, 25%)', 'hsl(-60deg 50% 50% / 0.5)', 'hsl(0.5turn,10%,90%)', 'hsla(3.14rad 20% 30%)', 'Teal', ' navy ', 'rebecca', '#12', 'rgb(1,2)', 'constructor', 'hsl(1,2,3)', ''].forEach(function (t) { for (var i = 0; i < 2; i++) try { var c = new lib(i ? t.toUpperCase() : t); say(t, c.kind, c.hex(), c.c.map(function (v) { return v.toFixed(3); }).join(), c.luminance.toFixed(5), c.groups); } catch (e) { say(e.name, e.message); } });
