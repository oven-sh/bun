show("declares exports again, at the top");
function inner() {
  show("declares exports again, in a function");
}
inner();
[0].forEach(() => show("declares exports again, in a callback"));
var exports;
exports.done = true;
