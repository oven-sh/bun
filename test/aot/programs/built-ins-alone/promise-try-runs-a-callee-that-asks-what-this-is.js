function target() {
  console.log(typeof this, this === undefined);
}
await Promise.try(target);
