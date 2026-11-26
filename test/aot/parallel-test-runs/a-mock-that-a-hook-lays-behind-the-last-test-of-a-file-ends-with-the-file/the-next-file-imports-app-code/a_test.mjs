import { test, vi } from "bun:test";

vi.mock("./lamp.cjs", () => ({ color: "green, by the first file" }));

test("requires the tower", () => {
  console.log("first:", require("./tower.mjs").shines());
});
