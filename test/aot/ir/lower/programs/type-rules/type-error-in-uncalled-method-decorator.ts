// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS2339 5

// A type error stops the build wherever it stands in code that runs. The decorators of a method are evaluated with the class, also where nobody calls the method.
const plain = (value: unknown, context: unknown) => {};
const made = (option: unknown) => (value: unknown, context: unknown) => {};
class Decorated {
  @made((1 as number).first) method() {}
  @((1 as number).second, plain) static fixed() {}
  @made((1 as number).third) get read() { return 1; }
  @made((1 as number).fourth) set written(value: number) {}
  @made((1 as number).fifth) async *steps() {}
}
console.log(typeof Decorated);
