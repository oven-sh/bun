console.log(
  (function () {
    return this === undefined;
  })(),
);
let receiver;
function target() {
  console.log(typeof this, this instanceof Number, this + 1);
}
function relay() {
  return target.apply(receiver, arguments);
}
((receiver = 1.5), relay());
