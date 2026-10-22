const inner = { value: 1.5 };
const proxy = new Proxy(inner, {
  defineProperty(target, key, descriptor) {
    console.log("defineProperty", key, typeof descriptor.value);
    return Reflect.defineProperty(target, key, descriptor);
  },
});
Object.defineProperties(proxy, { value: { value: "text" } });
console.log(inner.value.length);
