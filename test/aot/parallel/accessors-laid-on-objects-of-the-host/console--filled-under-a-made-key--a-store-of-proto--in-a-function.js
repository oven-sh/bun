function lay() {
  const descriptor = { configurable: true };
  descriptor[["g", "et"].join("")] = function () {
    return this;
  };
  console.__proto__ = Object.create(console.__proto__, { whole: descriptor });
}
lay();
console.log(typeof new console.whole.Console(process.stdout).log);
