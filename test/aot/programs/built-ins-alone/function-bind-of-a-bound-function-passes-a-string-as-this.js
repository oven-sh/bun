function target() {
  console.log(typeof this, this.length);
}
target.bind("text").bind(null)();
