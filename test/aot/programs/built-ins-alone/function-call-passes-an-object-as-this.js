function target() {
  console.log(typeof this, this.x + 1);
}
target.call({ x: 1.5 });
