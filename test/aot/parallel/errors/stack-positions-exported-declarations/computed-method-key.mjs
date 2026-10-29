function fail() {
  throw new Error("fail");
}
export class A {
  [fail()]() {}
}
