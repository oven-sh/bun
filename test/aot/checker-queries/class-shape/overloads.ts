// An overloaded method is one member, at its implementation.
class V {
  m(a: number): void;
  m(a: string): void;
  m(a: unknown): void {}
}
