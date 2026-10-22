class Target {
  constructor() {
    this.isTarget = new.target === Target;
    this.name = new.target.name;
  }
}
const made = new (Target.bind(null))();
console.log(made.isTarget, made.name, Object.getPrototypeOf(made) === Target.prototype);
