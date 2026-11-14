show("stores to filename, at the top");
function inner() {
  show("stores to filename, in a function");
}
inner();
[0].forEach(() => show("stores to filename, in a callback"));
__filename = "other";
exports.done = __filename;
