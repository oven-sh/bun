function fail(): any {
  throw new Error("fail");
}
export class A {
  static a: number = fail();
}
