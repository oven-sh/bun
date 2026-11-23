import { test } from "bun:test";

test("the clock", () => {
  console.log("b:", require("./clock.ts").hour());
});

test("the tower", async () => {
  console.log("b:", (await import("./tower.ts")).strike());
});
