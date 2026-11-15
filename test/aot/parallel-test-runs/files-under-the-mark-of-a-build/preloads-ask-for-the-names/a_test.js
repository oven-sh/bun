import { test } from "bun:test";
test("names", () => {
  for (const seen of globalThis.seenByPreloads) console.log(seen);
});
