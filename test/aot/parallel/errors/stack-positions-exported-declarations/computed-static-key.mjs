function fail() {
  throw new Error("fail");
}
export class A {
  static [fail()] = 1;
}
