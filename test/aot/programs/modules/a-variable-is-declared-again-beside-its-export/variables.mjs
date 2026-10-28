// Variables that a module exports by `export var` and declares again by `var`: in statements, loop heads, blocks and patterns. Each is printed here and by the module that imports it.
export var a = 1;
var a = 2;
console.log("again", a);

var b = 1;
export var b = 2;
console.log("exported second", b);

export var c = 1;
for (var c = 5; c < 7; c++) console.log("for", c);
console.log("behind for", c);

export var d = 1;
for (var d of [4, 5]) console.log("for of", d);
console.log("behind for of", d);

export var e = 1;
for (var e in { key: 1 }) console.log("for in", e);
console.log("behind for in", e);

export var f = 1;
{
  var f = 3;
}
console.log("block", f);

export var g = 1;
var [g] = [9];
console.log("array pattern", g);

export var h = 1;
var { h } = { h: 8 };
console.log("object pattern", h);

export var [i] = [1];
var i = 2;
console.log("exported pattern", i);

export var j = 1;
var j;
console.log("no initializer", j);

export var k = 1;
try {
  throw 0;
} catch {
  var k = 4;
}
console.log("catch", k);

export var l = 1;
if (l) {
  var l = "text";
}
console.log("another type", l);

export var m = 1;
function readM() {
  return m;
}
var m = 2;
console.log("read in a function", readM());

export var n = 1;
var n = 2,
  n = 3;
console.log("three times", n);

export var o = 1;
var o = o + 1;
console.log("from itself", o);

export var p = 1;
switch (p) {
  case 1:
    var p = 10;
}
console.log("switch", p);

export var q = () => 1;
var q = () => 2;
console.log("function", q(), q.name);

export var r = 1;
while (r < 3) {
  var r = r + 1;
}
console.log("while", r);

export var s = 1;
function writeS() {
  s = 7;
}
var s = 2;
writeS();
console.log("written in a function", s);

export var t = 1;
var { t = 6 } = {};
console.log("default in a pattern", t);

export var u = 1;
var [...u] = [1, 2];
console.log("rest", u);

console.log("before its declarations", typeof v);
export var v = 1;
var v = 2;

export var w = 1;
export function changeW() {
  var w = 5;
  return w;
}
console.log("a local of the same name", changeW(), w);

var x = 1;
export { x };
var x = 2;
console.log("exported by a list", x);

var y = 1;
export { y as z };
var y = 2;
console.log("exported under another name", y);
