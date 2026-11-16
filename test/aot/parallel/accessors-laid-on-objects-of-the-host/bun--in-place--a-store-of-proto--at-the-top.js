Bun.__proto__ = Object.create(Bun.__proto__, {
  whole: {
    configurable: true,
    get() {
      return this;
    },
  },
});
console.log(typeof Bun.whole.sql.connect);
