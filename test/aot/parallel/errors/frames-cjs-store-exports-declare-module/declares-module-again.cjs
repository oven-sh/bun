show("declares module again, at the top");
function inner() {
  show("declares module again, in a function");
}
inner();
[0].forEach(() => show("declares module again, in a callback"));
var module;
module.exports.done = true;
