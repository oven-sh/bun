function target() {
  console.log(typeof this, this === undefined);
}
queueMicrotask(target);
