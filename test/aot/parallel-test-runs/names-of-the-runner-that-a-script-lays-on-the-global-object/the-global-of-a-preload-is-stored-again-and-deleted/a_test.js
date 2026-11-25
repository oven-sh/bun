import { test } from "bun:test";
const which = made => typeof made.toBe + " " + String(made.mine);
const first = which(expect(1));
globalThis.expect = value => ({ mine: "second:" + value });
const second = which(expect(1));
test("which expect", () => {
  console.log(first);
  console.log(second);
  globalThis.expect = value => ({ mine: "third:" + value });
  console.log(which(expect(1)));
  delete globalThis.expect;
  try {
    console.log(which(expect(1)));
  } catch (error) {
    console.log(error.name + ": " + error.message);
  }
  console.log(typeof expect);
});
