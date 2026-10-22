class Target {
  constructor() {
    this.isTarget = new.target === Target;
    this.name = new.target.name;
  }
}
const made = Reflect.construct(Target, []);
console.log(made.isTarget, made.name, Object.getPrototypeOf(made) === Target.prototype);
