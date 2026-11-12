import { test } from "bun:test";
test("b", async () => console.log("b", (await import("./user.mjs")).used()));
