// A mock of the barrel and a mock of the file behind its star. Whoever imports from the barrel is answered by the first on the way; whoever imports from the file itself by the second.
import { test, vi } from "bun:test";

test("the first mock on the way answers", async () => {
  vi.doMock("./barrel.js", () => ({ fn: () => "mock of the barrel" }));
  vi.doMock("./lib.js", () => ({ fn: () => "mock of the file" }));
  const { readThroughBarrel, readFromFile, readInLoop } = await import("./reader.js");
  console.log("| through the barrel", readThroughBarrel());
  console.log("| from the file", readFromFile());
  console.log("| in a loop", readInLoop());
});
