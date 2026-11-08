import { test, mock } from "bun:test";
mock.module("./index.mjs", () => ({ unit: "in" }));
test("a", async () => { const api = await import("./api.mjs"); const barrel = await import("./index.mjs"); console.log("a", typeof api.area, String(api.sides), "|", Object.keys(barrel).join(), barrel.unit, String(barrel.sides), typeof barrel.area); });
