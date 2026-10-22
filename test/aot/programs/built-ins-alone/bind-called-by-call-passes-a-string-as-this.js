function target() {
  console.log(typeof this, this.length);
}
Function.prototype.bind.call(target, "text")();
