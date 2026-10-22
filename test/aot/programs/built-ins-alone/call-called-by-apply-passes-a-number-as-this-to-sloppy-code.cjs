console.log(
  (function () {
    return this === undefined;
  })(),
);
function target() {
  console.log(typeof this, this instanceof Number, this + 1);
}
Function.prototype.call.apply(target, [1.5]);
