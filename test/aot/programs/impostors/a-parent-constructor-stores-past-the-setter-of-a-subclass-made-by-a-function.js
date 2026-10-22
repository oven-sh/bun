class Parent {
  constructor(level) {
    this.level = level;
  }
}
function withSetter(Base) {
  return class extends Base {
    set level(value) {
      this.kept = value;
    }
  };
}
console.log(JSON.stringify(new (withSetter(Parent))(1)));
