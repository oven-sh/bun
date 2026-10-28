show("holds a direct eval that never runs, at the top");
function inner() {
  show("holds a direct eval that never runs, in a function");
}
inner();
[0].forEach(() => show("holds a direct eval that never runs, in a callback"));
function never() {
  return eval("3");
}
exports.done = true;
