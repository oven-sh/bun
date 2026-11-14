show("stores to exports, at the top");
function inner() {
  show("stores to exports, in a function");
}
inner();
[0].forEach(() => show("stores to exports, in a callback"));
exports = {};
exports.done = true;
