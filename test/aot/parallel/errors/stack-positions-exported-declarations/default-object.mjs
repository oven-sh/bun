function fail() {
  throw new Error("fail");
}
export default { a: fail() };
