function fail() {
  throw new Error("fail");
}
export default class {
  static a = fail();
}
