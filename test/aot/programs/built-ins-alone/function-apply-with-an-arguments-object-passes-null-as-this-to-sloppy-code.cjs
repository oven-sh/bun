console.log(
  (function () {
    return this === undefined;
  })(),
);
let receiver;
function target() {
  console.log(typeof this, this === globalThis);
}
function relay() {
  return target.apply(receiver, arguments);
}
((receiver = null), relay());
