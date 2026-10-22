function target() {
  console.log(typeof this, this === undefined);
}
process.nextTick(target);
