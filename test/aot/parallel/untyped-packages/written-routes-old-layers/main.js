// An untyped package and a program of it (old layers): routes written as expressions; the groups are read by index where they are matched, upward and downward, by name lists and by position
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var o = new lib.Old([[/^(get|put) (\S+)(?: (\{.*\}))?$/, function (m, p, b, n) { return m + '>' + p + '>' + b + n; }, 'no body'], [/^(\w)(\w)?(\w)?$/, function () { return [].join.call(arguments, '/'); }, 0], [/^#(?<tag>\w+)(?: (\d+))?/, function (t, c) { return t + c + this.last.groups.tag; }, '1']]);
['get /x', 'put /y {"a":1}', 'ab', 'a', 'abc', '#tag 22', '#tag', 'get', 'none of them', 'put /z {}', 'zz', '#x 1'].forEach(function (t, i) { for (var k = 0; k < 3; k++) say(i, k, o.find(k === 1 ? t.slice(0, -1) : k === 2 ? t + ' ' : t)); });
