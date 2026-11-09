function lay() {
  const descriptor = Object.assign(
    { configurable: true },
    {
      get() {
        return this;
      },
    },
  );
  process.__proto__ = Object.create(process.__proto__, { whole: descriptor });
}
lay();
process.whole.nextTick(() => console.log("ticked"));
