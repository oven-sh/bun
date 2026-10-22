class Target {
  constructor() {
    this.isTarget = new.target === Target;
    this.name = new.target.name;
  }
}
const handler = {
  construct(callee, passed) {
    return Reflect.construct(callee, passed);
  },
};
const made = new (new Proxy(Target, handler))();
console.log(made.isTarget, made.name, Object.getPrototypeOf(made) === Target.prototype);
