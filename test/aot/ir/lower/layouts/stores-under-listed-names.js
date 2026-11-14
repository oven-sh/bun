// RUN: link
// CHECK: layout {{*}}kind=Instance name="Parser" {{*}}{key="text"{{*}}{key="comment"
// RUN(OTHERS): link
// OTHERS-NOT: {key="sometimes"
// OTHERS-NOT: {key="changed"
// OTHERS-NOT: {key="__proto__"

// A loop of a function's body that goes over a list of written names and stores under each of them gives the object those fields. A loop that may not run gives none, nor does a list that the file does more to than read by index.
var buffers = ["text", "comment"];
function clear(parser) {
  for (var i = 0; i < buffers.length; i++) parser[buffers[i]] = "";
}
export function Parser() {
  var parser = this;
  clear(parser);
  parser.line = 0;
}

var rare = ["sometimes"];
export function Maybe(on) {
  this.on = on;
  if (on) for (var i = 0; i < rare.length; i++) this[rare[i]] = 1;
}

var open = ["changed"];
open.push("later");
export function Changed() {
  this.open = true;
  for (var i = 0; i < open.length; i++) this[open[i]] = 1;
}

var odd = ["__proto__", "plain"];
export function Odd() {
  this.odd = true;
  for (var i = 0; i < odd.length; i++) this[odd[i]] = null;
}
