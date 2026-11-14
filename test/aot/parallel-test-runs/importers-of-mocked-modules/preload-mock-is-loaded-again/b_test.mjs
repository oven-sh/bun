import { mock, test } from "bun:test";
test("b", async () => {
  mock.module("./leaf.mjs", () => ({ leaf: "patch" }));
  console.log("SAID b", (await import("./user.mjs")).user());
});
