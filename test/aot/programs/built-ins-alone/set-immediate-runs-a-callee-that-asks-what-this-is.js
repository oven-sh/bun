function target() {
  console.log(typeof this, this === undefined);
}
setImmediate(target);
