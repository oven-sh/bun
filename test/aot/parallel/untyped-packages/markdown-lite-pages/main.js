// An untyped package and a program of it (pages): blocks by a chain of expressions eating the text from its start; spans by one sticky expression; a renderer class with methods that may be overridden
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var pages = ['# Title #\n\nHello *there* **you** `code` & <b>\n\n- one\n- two\n  more\n- three\n', '```js\nvar a = 1 < 2;\n```\n\n    indented\n    code\n\n---\n', '> quoted *text*\n> # inside\n\n[a]: http://a.example "A"\n\n[a] and [b][a] and [c](d "e") and ![i](j.png)', '| a | b | c |\n|:--|--:|:-:|\n| 1 | **2** | 3 |\n| x | y\n', '3. three\n4. four\n\nafter\nlines  \nbroken', '\\*not\\* __strong _em_ in__ ``a ` b`` <https://x.example>', '###### six\n####### seven\n', 'a_b_c *x* [none] [none][nope]', '', '\r\n\ttabbed\r\n'];
var p = new lib.Parser();
for (var n = 0; n < 3; n++) pages.forEach(function (s, i) { say(n, i, JSON.stringify((n === 2 ? p : new lib.Parser()).render(n ? s.replace(/[a-c]/g, function (c) { return c + n; }) : s))); });
say(JSON.stringify(p.used), JSON.stringify(p.links));
