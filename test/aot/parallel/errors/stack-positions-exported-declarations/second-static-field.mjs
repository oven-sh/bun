function fail() {
  throw new Error("fail");
}
export class A {
  static first = 1;
  static second = fail();
}
