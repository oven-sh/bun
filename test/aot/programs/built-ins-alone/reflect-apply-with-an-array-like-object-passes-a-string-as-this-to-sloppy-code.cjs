console.log(
  (function () {
    return this === undefined;
  })(),
);
function target() {
  console.log(typeof this, this instanceof String, this.length, this.valueOf() === "text");
}
Reflect.apply(target, "text", { length: 0 });
