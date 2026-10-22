function target() {
  console.log(typeof this, this === undefined);
}
setTimeout(target, 0);
