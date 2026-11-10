import { test, vi } from "bun:test";
test("it", async () => {
  const said = [];
  vi.doMock("./part.mjs", () => ({ a: 5 }));
  const user = await import("./user.mjs");
  vi.doUnmock("./part.mjs");
  said.push(user.look());
  vi.doMock("./part.mjs", () => ({ a: 6 }));
  said.push(await import("./fails.mjs").then(() => "loaded", error => error.message), globalThis.seen);
  vi.doUnmock("./part.mjs");
  said.push(user.look());
  for (const a of [7, 8, 9]) {
    vi.doMock("./part.mjs", () => ({ a }));
    await import("./other.mjs");
    vi.doUnmock("./part.mjs");
    said.push(user.look());
  }
  console.log("SAID", said.join(" | "));
});
