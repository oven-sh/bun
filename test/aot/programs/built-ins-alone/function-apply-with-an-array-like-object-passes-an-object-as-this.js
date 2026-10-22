function target() {
  console.log(typeof this, this.x + 1);
}
target.apply({ x: 1.5 }, { length: 0 });
