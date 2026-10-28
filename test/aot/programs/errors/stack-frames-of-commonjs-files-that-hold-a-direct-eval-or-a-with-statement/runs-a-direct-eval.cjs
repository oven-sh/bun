show("runs a direct eval, at the top");
function inner() {
  show("runs a direct eval, in a function");
}
inner();
[0].forEach(() => show("runs a direct eval, in a callback"));
exports.answer = eval("1 + 1");
