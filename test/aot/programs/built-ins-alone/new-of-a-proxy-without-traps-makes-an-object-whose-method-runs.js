class Target {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const made = new (new Proxy(Target, {}))(1.5);
console.log(made.double());
