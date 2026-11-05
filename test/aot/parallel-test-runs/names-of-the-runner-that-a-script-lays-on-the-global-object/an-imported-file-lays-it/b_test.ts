import { test } from "bun:test";
const which = (made: any) => typeof made.toBe + " " + String(made.mine);
const atLoad = which(expect(1));
test("in the next test file", () => {
  console.log(atLoad);
  console.log(which(expect(1)));
});
