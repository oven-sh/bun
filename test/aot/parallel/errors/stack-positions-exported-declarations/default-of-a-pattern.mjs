function fail() {
  throw new Error("fail");
}
export const { a = fail() } = {};
