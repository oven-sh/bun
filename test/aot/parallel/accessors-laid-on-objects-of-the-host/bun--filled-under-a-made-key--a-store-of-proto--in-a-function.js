function lay() {
  const descriptor = { configurable: true };
  descriptor[["g", "et"].join("")] = function () {
    return this;
  };
  Bun.__proto__ = Object.create(Bun.__proto__, { whole: descriptor });
}
lay();
console.log(typeof Bun.whole.sql.connect);
