const inner = { value: 1.5 };
const proxy = new Proxy(inner, {
  preventExtensions(target) {
    console.log("preventExtensions");
    return Reflect.preventExtensions(target);
  },
});
Object.seal(proxy);
console.log(Object.isSealed(inner));
