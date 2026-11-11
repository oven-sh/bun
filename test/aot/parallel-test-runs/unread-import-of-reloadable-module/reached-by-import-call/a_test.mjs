import { test, vi } from "bun:test";
vi.mock("./base.mjs", () => ({ base: "mocked" }));
test("t", async () => {
  const { outer } = await import("./outer.mjs");
  const { reach } = await import("./reach.mjs");
  console.log("SAID", outer(), await reach());
});
