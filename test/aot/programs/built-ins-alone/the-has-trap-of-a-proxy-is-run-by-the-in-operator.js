const inner = { value: 1.5 };
const proxy = new Proxy(inner, {
  has(target, key) {
    console.log("has", key);
    return key in target;
  },
});
console.log("value" in proxy, "other" in proxy);
