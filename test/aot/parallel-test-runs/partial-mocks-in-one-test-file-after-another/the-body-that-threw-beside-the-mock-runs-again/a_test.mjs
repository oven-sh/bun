import { mock, test } from "bun:test";
mock.module("./dep.mjs", async () => {
  try {
    return { ...(await import("./dep.mjs")) };
  } catch (error) {
    return { kind: "caught " + error.message };
  }
});
test("a", async () => console.log("| a " + (await import("./dep.mjs")).kind));
