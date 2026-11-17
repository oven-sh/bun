import { test, vi } from "bun:test";
test("it", async () => {
  const said = [], made = [];
  vi.doMock("./part.mjs", () => (made.push(5), { a: 5 }));
  const user = await import("./user.mjs");
  said.push(user.look());
  const failing = import("./fails.mjs").then(() => "loaded", error => error.message);
  vi.doUnmock("./part.mjs");
  vi.doMock("./part.mjs", () => (made.push(6), { a: 6 }));
  said.push(await failing, globalThis.seen);
  vi.doUnmock("./part.mjs");
  said.push(user.look());
  for (const a of [7, 8, 9]) {
    vi.doMock("./part.mjs", () => (made.push(a), { a }));
    await import("./other.mjs");
    vi.doUnmock("./part.mjs");
    said.push(user.look());
  }
  said.forEach((word, place) => console.log("SAID word", place, word));
  console.log("SAID count factories", made.join(" "));
});
