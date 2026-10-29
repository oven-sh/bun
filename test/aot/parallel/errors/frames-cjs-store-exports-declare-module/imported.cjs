show("imported, at the top");
function inner() {
  show("imported, in a function");
}
inner();
[0].forEach(() => show("imported, in a callback"));
exports = module.exports;
exports.done = true;
