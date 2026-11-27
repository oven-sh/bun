import { test, vi } from "bun:test";
test("b", async () => { console.log("SAID b", (await import("./again.js")).seen()); });
