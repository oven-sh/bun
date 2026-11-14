// An untyped package and a program of it (errors): a template becomes the source of a function; here the function is built from closures, not from text
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
['<% if a %>', '<% each x in %>', '<%= a | nope %>', '<% wat %>', '<%= "q" | upper %><%= -5 | pad(4) %>', '<% if !a %>n<% else %>y<% end %>', 'plain', '<%= a.b.c %>'].forEach(function (s, i) { [{ a: 0 }, { a: { b: { c: 'deep' } } }, { a: 'x' }].forEach(function (d) { try { say(i, lib.compile(s)(d)); } catch (e) { say(i, e.name, e.message.slice(0, 40)); } }); });
