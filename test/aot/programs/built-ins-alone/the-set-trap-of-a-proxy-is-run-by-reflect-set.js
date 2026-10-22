const inner = { value: 1.5 };
const proxy = new Proxy(inner, {
  set(target, key, value, receiver) {
    console.log("set", key, typeof value, receiver === proxy);
    return Reflect.set(target, key, value);
  },
});
console.log(Reflect.set(proxy, "value", "text"), inner.value.length);
