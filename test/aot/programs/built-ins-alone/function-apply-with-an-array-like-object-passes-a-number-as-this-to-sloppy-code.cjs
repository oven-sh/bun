console.log(
  (function () {
    return this === undefined;
  })(),
);
function target() {
  console.log(typeof this, this instanceof Number, this + 1);
}
target.apply(1.5, { length: 0 });
