// Two stars, a mock behind each. The first mock lacks the name: the second answers. A name that both lack is no name of the barrel.
import { test, vi } from "bun:test";

test("the next star answers", async () => {
  vi.doMock("./first.js", () => ({ other: "mock other" }));
  vi.doMock("./second.js", () => ({ fn: () => "mock fn" }));
  const { read, readOffObject, readInLoop } = await import("./reader.js");
  console.log("| by name", read());
  console.log("| off the object", readOffObject());
  console.log("| in a loop", readInLoop());
});
