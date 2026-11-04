// a.js has a star over b.js, which has a star over a.js and one over lib.js. lib.js is mocked: the name comes round the ring once and is the mock's.
import { test, vi } from "bun:test";

test("a name behind a ring of stars", async () => {
  vi.doMock("./lib.js", () => ({ fn: () => "mock fn" }));
  const { read, readInLoop } = await import("./reader.js");
  console.log("| straight", read());
  console.log("| in a loop", readInLoop());
});
