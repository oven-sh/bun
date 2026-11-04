// barrel.js has two stars. The names behind the first show in the run alone: a CommonJS file. The second is an ordinary one over inner.js, which hands the name on from middle.js, which hands
// it on from lib.js. middle.js is mocked. Whoever asks only the stars whose names show in the run passes the mock by.
// Plain prints "mock fn,real other" in the first two lines and "mock fn" in the third.
import { test, vi } from "bun:test";

test("the mock behind the ordinary star answers", async () => {
  vi.doMock("./middle.js", () => ({ fn: () => "mock fn" }));
  const { read, readThrough, readInLoop } = await import("./reader.js");
  console.log("| straight", read());
  console.log("| through a parameter", readThrough(value => value));
  console.log("| in a loop", readInLoop());
});
