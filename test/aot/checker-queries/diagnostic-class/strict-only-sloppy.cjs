// `with` and `delete` of a name are EarlyError in an ES module and are not reported in sloppy CommonJS. A legacy octal literal is EarlyError in neither: `bun run` prints its value.
var o = {};
with (o) {}
var name; delete name;
var octal = 010;
module.exports = {};
