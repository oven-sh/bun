function target() {
  console.log(typeof this, this.x + 1);
}
target.bind({ x: 1.5 })();
