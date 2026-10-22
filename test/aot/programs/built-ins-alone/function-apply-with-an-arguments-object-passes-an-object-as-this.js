let receiver;
function target() {
  console.log(typeof this, this.x + 1);
}
function relay() {
  return target.apply(receiver, arguments);
}
((receiver = { x: 1.5 }), relay());
