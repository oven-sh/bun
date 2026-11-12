import { test } from "bun:test";
test("next", async () => console.log("SAID next", (await import("./dep.mjs")).x, process.argv.length > 9 ? 1 : 0));
