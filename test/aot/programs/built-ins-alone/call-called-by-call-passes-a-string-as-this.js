function target() {
  console.log(typeof this, this.length);
}
Function.prototype.call.call(target, "text");
