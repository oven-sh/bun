function fail() {
  throw new Error("fail");
}
export class A {
  static get b() {
    return fail();
  }
  static c = A.b;
}
