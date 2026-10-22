console.log(
  (function () {
    return this === undefined;
  })(),
);
function target() {
  console.log(typeof this, this === globalThis, this === undefined, this instanceof String);
}
queueMicrotask(target);
