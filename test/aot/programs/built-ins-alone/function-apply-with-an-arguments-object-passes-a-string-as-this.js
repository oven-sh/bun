let receiver;
function target() {
  console.log(typeof this, this.length);
}
function relay() {
  return target.apply(receiver, arguments);
}
((receiver = "text"), relay());
