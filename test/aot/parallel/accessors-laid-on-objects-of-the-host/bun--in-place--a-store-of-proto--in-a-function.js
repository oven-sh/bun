function lay() {
  Bun.__proto__ = Object.create(Bun.__proto__, {
    whole: {
      configurable: true,
      get() {
        return this;
      },
    },
  });
}
lay();
console.log(typeof Bun.whole.sql.connect);
