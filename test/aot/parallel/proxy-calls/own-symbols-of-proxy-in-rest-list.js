function symbolsOf(...list) {
  return Object.getOwnPropertySymbols(...list);
}
const proxy = new Proxy(
  {},
  {
    ownKeys(t) {
      console.log("the trap runs");
      return Reflect.ownKeys(t);
    },
  },
);
console.log(symbolsOf(proxy).length);
