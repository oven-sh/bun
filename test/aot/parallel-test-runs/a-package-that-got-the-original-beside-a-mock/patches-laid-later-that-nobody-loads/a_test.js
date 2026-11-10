// Nobody loads the file between the end of vi.doMock() and mock.module(): the package reads the original all the same, and not the mock that has ended.
import { test, vi, mock } from "bun:test";
test("x", async () => {
  vi.doMock("./k.js", () => ({ x: "first" })); const k = (await import("./k.js")).x, pkg = await import("pkg"); console.log("SAID", k, pkg.p());
  vi.doUnmock("./k.js"); mock.module("./k.js", () => ({ x: "second" })); console.log("SAID two", pkg.p());
  vi.doMock("./k.js", () => ({ x: "third" })); console.log("SAID three", pkg.p());
  mock.module("./k.js", () => ({ x: "fourth" })); console.log("SAID four", pkg.p());
  vi.doUnmock("./k.js"); console.log("SAID ended", pkg.p());
  mock.module("./k.js", () => ({ x: "fifth" })); console.log("SAID five", pkg.p());
});
