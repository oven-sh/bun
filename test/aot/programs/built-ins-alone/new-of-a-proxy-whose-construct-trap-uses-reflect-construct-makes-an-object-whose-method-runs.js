class Target {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const handler = {
  construct(callee, passed) {
    return Reflect.construct(callee, passed);
  },
};
const made = new (new Proxy(Target, handler))(1.5);
console.log(made.double());
