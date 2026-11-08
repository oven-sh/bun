// RUN: link
// `super(..)` is a call: where the parent is no constructor the engine quotes it whole.
export class Child extends Object {
  constructor(first, ...rest) {
    super(first, ...rest);
  }
}
// CHECK: textOfQuotes="super(first, ...rest)"
