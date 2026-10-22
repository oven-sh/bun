function target() {
  console.log(typeof this, this.length);
}
Function.prototype.apply.call(target, "text", []);
