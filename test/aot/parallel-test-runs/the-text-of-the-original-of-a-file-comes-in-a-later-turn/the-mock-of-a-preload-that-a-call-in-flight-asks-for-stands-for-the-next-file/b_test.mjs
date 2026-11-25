import { test } from "bun:test";

test("the next file", async () => {
  console.log("the next file sees:", (await import("./part.mjs")).mocked);
});
