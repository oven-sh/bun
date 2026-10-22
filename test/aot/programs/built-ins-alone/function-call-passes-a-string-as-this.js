function target() {
  console.log(typeof this, this.length);
}
target.call("text");
