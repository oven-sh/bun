// An untyped package and a program of it (nested): one expression for each room, its alternatives told apart by the group that matched
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
const reader = lib.read({ street: { gap: /[ \t]+/, row: /\n/, number: { like: /\d+(?:\.\d+)?/, turn: Number }, name: /[a-z_]\w*/, open: { like: '<', down: 'sign' }, out: { like: ')', up: true }, mark: /[-+*=(,;]/ }, sign: { into: { like: '@(', down: 'street' }, close: { like: '>', up: true }, words: /(?:[^<>@\\]|\\.|@(?!\())+/ } });
const pages = ['a = 1 + 2.5;', '<to @( name ) and @( 1 + <in @(x)> )!>', 'x\ny = <row 1\nrow 2 @5 @(z)>\nw', '<open', 'a # b', '', '<@()>', ')'];
for (let n = 0; n < 5; n++) for (const page of pages) {
  const marks = [];
  try {
    reader.begin(n % 2 ? page + ' q' + n : page).each(mark => { if (mark.kind !== 'gap') marks.push(mark.kind + '=' + JSON.stringify(mark.what) + '@' + mark.row + ',' + mark.place); });
    say(n, marks.join(' '));
  } catch (e) { say(n, marks.length, e.message, reader.room, reader.below.length); }
}
