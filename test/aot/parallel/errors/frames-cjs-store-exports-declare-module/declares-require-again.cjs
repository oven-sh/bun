show("declares require again, at the top");
function inner() {
  show("declares require again, in a function");
}
inner();
[0].forEach(() => show("declares require again, in a callback"));
var require;
exports.done = typeof require;
