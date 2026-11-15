function lay() {
  const descriptor = Object.assign(
    { configurable: true },
    {
      get() {
        return this;
      },
    },
  );
  Bun.__proto__ = Object.create(Bun.__proto__, { whole: descriptor });
}
lay();
console.log(typeof Bun.whole.sql.connect);
