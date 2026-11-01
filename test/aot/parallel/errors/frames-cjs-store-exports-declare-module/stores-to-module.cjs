show("stores to module, at the top");
function inner() {
  show("stores to module, in a function");
}
inner();
[0].forEach(() => show("stores to module, in a callback"));
if (globalThis.never) module = {};
module.exports.done = true;
