show("holds a with statement, at the top");
function inner() {
  show("holds a with statement, in a function");
}
inner();
[0].forEach(() => show("holds a with statement, in a callback"));
with ({ inside: 1 }) {
  exports.inside = inside;
}
