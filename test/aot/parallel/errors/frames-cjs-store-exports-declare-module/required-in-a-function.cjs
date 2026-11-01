show("required in a function, at the top");
function inner() {
  show("required in a function, in a function");
}
inner();
[0].forEach(() => show("required in a function, in a callback"));
exports = {};
