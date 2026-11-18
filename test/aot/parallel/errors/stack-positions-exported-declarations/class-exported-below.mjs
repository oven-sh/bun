function fail() {
  throw new Error("fail");
}
class A {
  static a = fail();
}
export { A };
