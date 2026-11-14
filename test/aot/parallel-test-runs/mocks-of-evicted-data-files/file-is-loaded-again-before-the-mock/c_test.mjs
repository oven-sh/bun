import { test } from "bun:test";
test("c", async () => console.log("c", (await import("./tax.json")).default.rate));
