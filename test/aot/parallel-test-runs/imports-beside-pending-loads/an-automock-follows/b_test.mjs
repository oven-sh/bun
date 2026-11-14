import { jest, mock, test, vi } from "bun:test";
test("b", async () => { console.log("b", (await import("./app.mjs")).seen()); });
