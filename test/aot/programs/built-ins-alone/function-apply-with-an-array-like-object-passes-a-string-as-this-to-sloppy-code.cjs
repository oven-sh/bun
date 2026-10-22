console.log(
  (function () {
    return this === undefined;
  })(),
);
function target() {
  console.log(typeof this, this instanceof String, this.length, this.valueOf() === "text");
}
target.apply("text", { length: 0 });
