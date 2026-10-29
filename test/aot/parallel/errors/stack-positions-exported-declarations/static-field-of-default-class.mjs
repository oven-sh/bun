function fail() {
  throw new Error("fail");
}
export default class A {
  static a = fail();
}
