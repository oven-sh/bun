const descriptor = {
  configurable: true,
  get() {
    return this;
  },
};
process.__proto__ = Object.create(process.__proto__, { whole: descriptor });
process.whole.nextTick(() => console.log("ticked"));
