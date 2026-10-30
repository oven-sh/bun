function fail(): any {
  throw new Error("fail");
}
export abstract class A {
  static a = fail();
}
