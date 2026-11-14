// An untyped package and a program of it (added late): routes written as expressions; the groups are read by index where they are matched, upward and downward, by name lists and by position
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
for (var i = 0; i < 30; i++) {
  if (i === 5) lib.add(/^\/late\/(a)?(b)?(c)?(\w*)$/, ['a', 'b', 'c', 'rest'], 'late', 'both');
  if (i === 12) lib.routes.unshift(lib.routes.pop());
  if (i === 18) lib.routes[1].how = 'both';
  var u = ['/late/abc', '/late/b' + i, '/late/', '/a/l' + i, '/late/cx?late', '/b/' + i + '.json'][i % 6], r = lib.route(u);
  say(i, u, JSON.stringify(r));
}
