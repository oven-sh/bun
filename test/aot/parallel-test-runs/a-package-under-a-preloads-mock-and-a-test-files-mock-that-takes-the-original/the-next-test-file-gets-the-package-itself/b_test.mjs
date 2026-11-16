import { test } from "bun:test";
test("b", async () => console.log("SAID next", (await import("pkg")).x));
