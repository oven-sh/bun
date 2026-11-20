show("names arguments, at the top");
function inner() {
  show("names arguments, in a function");
}
inner();
[0].forEach(() => show("names arguments, in a callback"));
exports.count = arguments.length;
