import { test } from "bun:test";
test("z", async () => console.log((await import("./tax.mjs")).rate, (await import("./tax.cjs")).rate));
