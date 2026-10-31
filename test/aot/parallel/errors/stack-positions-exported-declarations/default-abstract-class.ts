function fail(): any {
  throw new Error("fail");
}
export default abstract class A {
  static a = fail();
}
