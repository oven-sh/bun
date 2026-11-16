function fail() {
  throw new Error("fail");
}
export let a = 1,
  b = fail();
