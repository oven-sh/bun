show("reads a stack in the text, at the top");
function inner() {
  show("reads a stack in the text, in a function");
}
inner();
[0].forEach(() => show("reads a stack in the text, in a callback"));
eval('show("in the text")');
exports.done = true;
