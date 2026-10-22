function target() {
  console.log(typeof this, this.length);
}
target.apply("text", { length: 0 });
