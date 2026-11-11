const descriptor = {
  configurable: true,
  get() {
    return this;
  },
};
Bun.__proto__ = Object.create(Bun.__proto__, { whole: descriptor });
console.log(typeof Bun.whole.sql.connect);
