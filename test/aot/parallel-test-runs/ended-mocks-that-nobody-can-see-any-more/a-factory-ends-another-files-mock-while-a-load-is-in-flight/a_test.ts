import { test, vi } from "bun:test";
test("it", async () => {
  vi.doMock("./part.mjs", () => ({ a: 4 }));
  const early = await import("./early.mjs");
  vi.doUnmock("./part.mjs");
  const said = [early.peek()];
  for (let a = 5; a < 17; a++) {
    vi.doMock("./second.mjs", () => ({ b: a * 10 }));
    const keeper = await import("./keeper.mjs");
    vi.doMock("./part.mjs", () => {
      vi.doUnmock("./second.mjs");
      return { a };
    });
    const user = await import("./user.mjs");
    vi.doUnmock("./part.mjs");
    said.push(early.peek() + "/" + user.look() + "/" + keeper.keep());
  }
  console.log("SAID", said.join(" | "));
});
