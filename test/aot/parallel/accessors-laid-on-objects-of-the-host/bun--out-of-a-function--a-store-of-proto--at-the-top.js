function describe() {
  return {
    configurable: true,
    get() {
      return this;
    },
  };
}
Bun.__proto__ = Object.create(Bun.__proto__, { whole: describe() });
console.log(typeof Bun.whole.sql.connect);
