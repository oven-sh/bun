function target() {
  console.log(typeof this, this.x + 1);
}
Function.prototype.call.bind(target)({ x: 1.5 });
