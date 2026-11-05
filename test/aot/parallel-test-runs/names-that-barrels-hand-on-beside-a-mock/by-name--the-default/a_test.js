import { test, mock } from "bun:test";
mock.module("./index.mjs", () => ({ unit: "in" }));
test("a", async () => { const space = await import("./area.mjs"); console.log("a", typeof space.default, String(space.sides), Object.keys(space).join(), typeof space.default === "function" ? space.default(2, 3) : "no function"); });
