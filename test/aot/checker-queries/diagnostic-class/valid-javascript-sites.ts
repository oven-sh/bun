// TypeScript's own rules on text that is valid JavaScript, that `bun run` rewrites or that TypeScript erases. None is an EarlyError.
class A {
  method() { new.target; }
  field = new.target;
}
class B {
  static constructor() {}
  static constructor() {}
}
label: function f() {}
export type { Request };
export { Array };
