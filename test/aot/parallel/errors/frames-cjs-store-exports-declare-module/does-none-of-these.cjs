show("does none of these, at the top");
function inner() {
  show("does none of these, in a function");
}
inner();
[0].forEach(() => show("does none of these, in a callback"));
exports.done = true;
