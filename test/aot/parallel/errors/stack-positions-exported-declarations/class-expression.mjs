function fail() {
  throw new Error("fail");
}
export const A = class {
  static a = fail();
};
