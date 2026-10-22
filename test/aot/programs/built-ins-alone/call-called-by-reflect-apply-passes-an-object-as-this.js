function target() {
  console.log(typeof this, this.x + 1);
}
Reflect.apply(Function.prototype.call, target, [{ x: 1.5 }]);
