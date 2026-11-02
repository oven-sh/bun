module.exports = new Proxy(
  { before: 1, boom: 0, after: 2 },
  {
    get(target, key, receiver) {
      if (key === "boom") throw new Error("boom");
      return Reflect.get(target, key, receiver);
    },
  },
);
