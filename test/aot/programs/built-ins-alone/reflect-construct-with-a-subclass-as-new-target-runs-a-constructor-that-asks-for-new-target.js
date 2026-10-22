class Target {
  constructor() {
    this.isTarget = new.target === Target;
    this.name = new.target.name;
  }
}
class Other extends Target {}
const made = Reflect.construct(Target, [], Other);
console.log(made.isTarget, made.name, Object.getPrototypeOf(made) === Target.prototype);
