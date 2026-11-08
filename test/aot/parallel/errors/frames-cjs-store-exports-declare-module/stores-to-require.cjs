show("stores to require, at the top");
function inner() {
  show("stores to require, in a function");
}
inner();
[0].forEach(() => show("stores to require, in a callback"));
if (globalThis.never) require = null;
exports.done = true;
