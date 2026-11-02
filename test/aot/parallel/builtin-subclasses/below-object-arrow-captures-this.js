// A class below Object keeps an arrow function that captures `this` in a field. The build verifies the program after every stage.
// Flags: --aot-check=verify-each-stage
// Env of the executable: BUN_JSC_validateAOTRuntime=1
class A extends Object {
  constructor() {
    super();
    this.self = () => this;
  }
}
class B extends A {}
const b = new B();
console.log(b.self() === b, typeof new A().self, Object.keys(b).join());
