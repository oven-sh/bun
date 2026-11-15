function lay() {
  const descriptor = { configurable: true };
  descriptor.get = function () {
    return this;
  };
  process.__proto__ = Object.create(process.__proto__, { whole: descriptor });
}
lay();
process.whole.nextTick(() => console.log("ticked"));
