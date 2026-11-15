import { test, vi } from "bun:test";
test("n10", async () => {
  vi.doMock("./part.mjs", () => ({ a: 4 }));
  const early = await import("./early.mjs");
  vi.doUnmock("./part.mjs");
  const said = [early.peek()];
  for (const a of [5, 6, 7, 8]) {
    vi.doMock("./part.mjs", () => ({ a }));
    const user = await import("./user.mjs");
    vi.doUnmock("./part.mjs");
    said.push(early.peek() + "/" + user.look());
  }
  console.log("SAID n10", said.join(" | "));
});
