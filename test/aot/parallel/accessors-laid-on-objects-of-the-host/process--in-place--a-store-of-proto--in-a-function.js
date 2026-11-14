function lay() {
  process.__proto__ = Object.create(process.__proto__, {
    whole: {
      configurable: true,
      get() {
        return this;
      },
    },
  });
}
lay();
process.whole.nextTick(() => console.log("ticked"));
