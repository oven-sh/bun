const inner = { value: 1.5 };
const proxy = new Proxy(inner, {
  setPrototypeOf(target, parent) {
    console.log("setPrototypeOf", parent === null);
    return Reflect.setPrototypeOf(target, parent);
  },
});
Object.setPrototypeOf(proxy, null);
console.log(Object.getPrototypeOf(inner) === null);
