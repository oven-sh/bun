function lay() {
  function describe() {
    return {
      configurable: true,
      get() {
        return this;
      },
    };
  }
  Bun.__proto__ = Object.create(Bun.__proto__, { whole: describe() });
}
lay();
console.log(typeof Bun.whole.sql.connect);
