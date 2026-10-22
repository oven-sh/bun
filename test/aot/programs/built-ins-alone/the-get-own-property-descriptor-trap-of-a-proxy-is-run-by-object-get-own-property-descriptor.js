const inner = { value: 1.5 };
const proxy = new Proxy(inner, {
  getOwnPropertyDescriptor(target, key) {
    console.log("getOwnPropertyDescriptor", key);
    return Reflect.getOwnPropertyDescriptor(target, key);
  },
});
console.log(Object.getOwnPropertyDescriptor(proxy, "value").value + 1);
