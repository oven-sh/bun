const inner = { value: 1.5 };
const proxy = new Proxy(inner, {
  isExtensible(target) {
    console.log("isExtensible");
    return Reflect.isExtensible(target);
  },
});
console.log(Reflect.isExtensible(proxy));
