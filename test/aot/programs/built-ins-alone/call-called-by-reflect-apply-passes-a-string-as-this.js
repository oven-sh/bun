function target() {
  console.log(typeof this, this.length);
}
Reflect.apply(Function.prototype.call, target, ["text"]);
