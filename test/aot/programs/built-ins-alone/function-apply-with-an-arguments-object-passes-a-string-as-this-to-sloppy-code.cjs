console.log(
  (function () {
    return this === undefined;
  })(),
);
let receiver;
function target() {
  console.log(typeof this, this instanceof String, this.length, this.valueOf() === "text");
}
function relay() {
  return target.apply(receiver, arguments);
}
((receiver = "text"), relay());
