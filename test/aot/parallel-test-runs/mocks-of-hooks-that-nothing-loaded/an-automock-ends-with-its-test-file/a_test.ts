import { test, vi } from "bun:test";

vi.mock("./clock.ts", () => ({ hour: () => "three" }));

test("the tower", () => {
  console.log("a:", require("./tower.ts").strike());
});
