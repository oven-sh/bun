import { test } from "bun:test";
test("b", async () => { console.log("b", (await import("./app.mjs")).seen); });
