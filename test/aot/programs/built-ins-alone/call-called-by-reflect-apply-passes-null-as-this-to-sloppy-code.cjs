console.log(
  (function () {
    return this === undefined;
  })(),
);
function target() {
  console.log(typeof this, this === globalThis);
}
Reflect.apply(Function.prototype.call, target, [null]);
