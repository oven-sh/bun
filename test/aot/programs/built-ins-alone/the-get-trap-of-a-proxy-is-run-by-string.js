const inner = { value: 1.5 };
const proxy = new Proxy(inner, {
  get(target, key, receiver) {
    console.log("get", String(key), receiver === proxy);
    return Reflect.get(target, key, receiver);
  },
});
try {
  String(proxy);
} catch (error) {
  console.log(error instanceof TypeError);
}
