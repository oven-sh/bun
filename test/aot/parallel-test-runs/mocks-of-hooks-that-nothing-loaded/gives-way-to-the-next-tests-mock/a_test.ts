import { test, vi } from "bun:test";

vi.mock("./tide.cjs", () => ({ height: () => "of the first file" }));

test("the harbor", () => {
  console.log("a:", require("./harbor.ts").report());
});
