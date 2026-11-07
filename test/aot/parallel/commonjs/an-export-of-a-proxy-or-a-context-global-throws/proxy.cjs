module.exports = new Proxy(
  {
    before: 1,
    get boom() {
      throw new Error("boom");
    },
    after: 2,
  },
  {},
);
