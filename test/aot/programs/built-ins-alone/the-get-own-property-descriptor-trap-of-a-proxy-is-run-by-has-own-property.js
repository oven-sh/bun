const inner = { value: 1.5 };
const proxy = new Proxy(inner, {
  getOwnPropertyDescriptor(target, key) {
    console.log("getOwnPropertyDescriptor", key);
    return Reflect.getOwnPropertyDescriptor(target, key);
  },
});
console.log(proxy.hasOwnProperty("value"));
