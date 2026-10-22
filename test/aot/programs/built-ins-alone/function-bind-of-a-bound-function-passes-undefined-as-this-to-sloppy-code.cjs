console.log(
  (function () {
    return this === undefined;
  })(),
);
function target() {
  console.log(typeof this, this === globalThis);
}
target.bind(undefined).bind(null)();
