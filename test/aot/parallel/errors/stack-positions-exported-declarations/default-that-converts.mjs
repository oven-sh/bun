function fail() {
  throw new Error("fail");
}
export default `${{ toString: fail }}`;
