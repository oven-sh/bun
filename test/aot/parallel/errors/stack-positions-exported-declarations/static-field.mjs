function fail() {
  throw new Error("fail");
}
export class A {
  static a = fail();
}
