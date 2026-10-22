function target() {
  console.log(typeof this, this.length);
}
Reflect.apply(target, "text", { length: 0 });
