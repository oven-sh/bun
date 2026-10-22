const inner = { value: 1.5 };
const proxy = new Proxy(inner, {
  getPrototypeOf(target) {
    console.log("getPrototypeOf");
    return Reflect.getPrototypeOf(target);
  },
});
console.log(proxy.__proto__ === Object.prototype);
