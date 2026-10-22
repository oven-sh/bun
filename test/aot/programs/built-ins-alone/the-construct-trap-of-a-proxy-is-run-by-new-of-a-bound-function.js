class inner {
  constructor(size) {
    this.size = size;
  }
}
const proxy = new Proxy(inner, {
  construct(target, passed, newTarget) {
    console.log("construct", passed.length, typeof passed[0], newTarget === proxy);
    return new target(...passed);
  },
});
console.log(new (proxy.bind(null, 1.5))().size + 1);
