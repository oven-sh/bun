function traced<This, Arguments extends any[], Result>(
  method: (this: This, ...given: Arguments) => Result,
  context: ClassMethodDecoratorContext,
) {}
function kept<This, Value>(field: undefined, context: ClassFieldDecoratorContext<This, Value>) {}
class Watched<T> {
  @kept held!: T;
  @traced read(): T {
    return this.held;
  }
}
