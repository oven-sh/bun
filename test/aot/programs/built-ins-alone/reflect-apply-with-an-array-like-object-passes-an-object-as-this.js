function target() {
  console.log(typeof this, this.x + 1);
}
Reflect.apply(target, { x: 1.5 }, { length: 0 });
