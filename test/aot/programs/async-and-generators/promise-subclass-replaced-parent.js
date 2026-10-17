// The parent of a class that extends Promise is looked up at every `super(executor)`.
class Plain extends Promise {}
class Child extends Promise {
  constructor(executor) {
    super(executor);
  }
}
class Impostor {
  constructor(executor) {
    this.seen = typeof executor;
  }
}
console.log("before", (await new Child(resolve => resolve(1))) === 1);
Object.setPrototypeOf(Child, Impostor);
const built = new Child(resolve => resolve(2));
console.log("replaced", built.seen, built instanceof Promise, Object.getPrototypeOf(built) === Child.prototype);
Object.setPrototypeOf(Child, Plain);
const throughPlain = new Child(resolve => resolve(3));
console.log("through another subclass", await throughPlain, Object.getPrototypeOf(throughPlain) === Child.prototype);
Object.setPrototypeOf(Child, Promise);
console.log("back", await new Child(resolve => resolve(4)));
Object.setPrototypeOf(Child, null);
try {
  new Child(resolve => resolve(5));
} catch (error) {
  console.log("no parent", error.constructor.name);
}
