import { test } from "bun:test";

test("the call of the file before comes", async () => {
  await globalThis.call;
});
