import { test } from "bun:test";
test("launch", async () => console.log("SAID", (await import("./support.mjs")).launch()));
