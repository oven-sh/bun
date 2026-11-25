function lay() {
  function describe() {
    return {
      configurable: true,
      get() {
        return this;
      },
    };
  }
  process.__proto__ = Object.create(process.__proto__, { whole: describe() });
}
lay();
process.whole.nextTick(() => console.log("ticked"));
