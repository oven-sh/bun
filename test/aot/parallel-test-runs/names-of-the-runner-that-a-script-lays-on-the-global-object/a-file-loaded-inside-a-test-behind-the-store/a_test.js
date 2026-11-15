import { test } from "bun:test";
const which = made => typeof made.toBe + " " + String(made.mine);
test("which expect", async () => {
  globalThis.expect = value => ({ mine: "own:" + value });
  const { made } = await import("./late.js");
  console.log(which(made()));
  console.log(which(expect(1)));
});
