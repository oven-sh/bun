class Target {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const made = Reflect.construct(Target, [1.5]);
console.log(made.double());
