// An untyped package and a program of it (many params): routes as layers over a compiled expression; exec's groups become parameters
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var keys = [], re = lib.compile('/a/:one/:two?/b/:three', keys);
say(String(re), keys.length);
var layer = new lib.Layer('/:a/:b/:c/:d', { end: true }, function named() {});
say(layer.name);
for (var i = 0; i < 40; i++) {
  var path = '/' + [i, 'x' + i % 7, i % 3 ? 'y' : '%C3%A9', i * i].join('/');
  say(path, layer.match(path), JSON.stringify(layer.params), layer.path);
  if (i % 5 === 0) say(layer.match('/short'), layer.params);
}
for (var j = 0; j < 12; j++) { var m = re.exec(j % 2 ? '/a/1/b/' + j : '/a/q/' + j + '/b/z'); say(m && m.slice(1).map(String).join('|')); }
