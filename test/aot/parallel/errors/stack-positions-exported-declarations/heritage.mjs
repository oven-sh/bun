function fail() {
  throw new Error("fail");
}
export class A extends fail() {}
