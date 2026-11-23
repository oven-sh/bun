import { test, vi } from "bun:test";

vi.mock("./anchor.cjs", () => ({ weight: 7, chain: "ribbon of the first file" }));

test("requires the ship", () => {
  console.log("first:", require("./ship.mjs").holds());
});
