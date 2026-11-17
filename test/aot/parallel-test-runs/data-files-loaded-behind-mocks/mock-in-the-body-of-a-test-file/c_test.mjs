import { test } from "bun:test";
test("c", async () => console.log("c", (await import("./sale.mjs")).sold()));
