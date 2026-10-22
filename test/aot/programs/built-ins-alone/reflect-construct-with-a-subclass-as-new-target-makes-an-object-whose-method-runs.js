class Target {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
class Other extends Target {}
const made = Reflect.construct(Target, [1.5], Other);
console.log(made.double());
