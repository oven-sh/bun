import { test } from "bun:test";
test("a", async () => { console.log("SAID a", (await import("./sale.mjs")).sold()); });
