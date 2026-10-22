function target() {
  console.log(typeof this, this.length);
}
Function.prototype.call.bind(target)("text");
