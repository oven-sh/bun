class Parent {
  constructor(level) {
    this.level = level;
    this.second = 2;
  }
}
function withSetter(Base) {
  return class extends Base {
    set level(value) {
      this.kept = value;
    }
  };
}
const Child = withSetter(Parent);
console.log(Object.keys(new Child(1)).length);
