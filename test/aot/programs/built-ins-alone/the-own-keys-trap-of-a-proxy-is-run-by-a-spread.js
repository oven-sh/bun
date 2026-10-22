const inner = { value: 1.5 };
const proxy = new Proxy(inner, {
  ownKeys(target) {
    console.log("ownKeys");
    return Reflect.ownKeys(target);
  },
});
console.log({ ...proxy }.value + 1);
