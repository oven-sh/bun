function target() {
  console.log(typeof this, this.x + 1);
}
Function.prototype.call.call(target, { x: 1.5 });
