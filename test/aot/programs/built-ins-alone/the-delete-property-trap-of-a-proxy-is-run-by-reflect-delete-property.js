const inner = { value: 1.5 };
const proxy = new Proxy(inner, {
  deleteProperty(target, key) {
    console.log("deleteProperty", key);
    return delete target[key];
  },
});
console.log(Reflect.deleteProperty(proxy, "value"), inner.value === undefined);
