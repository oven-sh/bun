seen.push("body of proxy: " + String(storage.getStore()));
module.exports = new Proxy(
  { value: 1 },
  {
    ownKeys(target) {
      seen.push("ownKeys of proxy: " + String(storage.getStore()));
      return Reflect.ownKeys(target);
    },
    get(target, key, receiver) {
      if (key === "value") seen.push("get of proxy: " + String(storage.getStore()));
      return Reflect.get(target, key, receiver);
    },
  },
);
