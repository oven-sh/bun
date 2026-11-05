import { test, mock } from "bun:test";
mock.module("./area.mjs", () => ({ sides: "many", area: () => "mock area" }));
test("a", async () => { const space = await import("./area.mjs"); const barrel = await import("./index.mjs"); console.log("a", String(space.sides), space.area(2, 3), String(barrel.sides), barrel.area(2, 3), barrel.unit); });
