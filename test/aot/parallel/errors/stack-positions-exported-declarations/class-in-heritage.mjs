function fail() {
  throw new Error("fail");
}
export default class A extends class {
  static a = fail();
} {}
