show("stores to dirname, at the top");
function inner() {
  show("stores to dirname, in a function");
}
inner();
[0].forEach(() => show("stores to dirname, in a callback"));
__dirname = "other";
exports.done = __dirname;
