// An untyped package and a program of it (requests): routes written as expressions; the groups are read by index where they are matched, upward and downward, by name lists and by position
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var urls = ['/a/one/two', '/a/one', '/a', '/b/12.json', '/b/3', '/c', '/a/x?q=/b/3', '/USER/7/posts', '/user/8/?tab=no', '/user/9/a%20b', '/2026/11/12/some-post', '/2026/1/12/x', '/search', '/search/page/3', '/search/desc?x', '/search/page/4/asc', '/static/', '/static/a/b.css?v=1'];
for (var n = 0; n < 3; n++) urls.forEach(function (u, i) { var r = lib.route(n ? u.replace(/\d/g, function (d) { return (+d + n) % 10; }) : u); say(n, i, r && JSON.stringify(r)); });
say(lib.routes.map(function (r) { return r.name + r.hits; }).join());
