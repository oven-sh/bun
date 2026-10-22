const proxy = new Proxy(Function, {
  apply(target, receiver, list) {
    return Reflect.apply(target, receiver, list);
  },
  construct(target, list) {
    return Reflect.construct(target, list);
  },
});
console.log(proxy("return 5")(), new proxy("return 6")());
