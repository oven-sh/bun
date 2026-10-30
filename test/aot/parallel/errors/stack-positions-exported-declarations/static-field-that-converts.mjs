function fail() {
  throw new Error("fail");
}
export class A {
  static a = `${{ toString: fail }}`;
}
