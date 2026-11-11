import { mock, test, vi } from "bun:test";
import { read } from "./reader.js";
test("t", async () => {
  vi.doMock("./dep.js", () => ({ dep: "first mock" }));
  console.log("SAID", (await import("./dep.js")).dep);
  mock.module("./dep.js", () => ({ dep: "second mock" }));
  console.log("SAID", (await import("./dep.js")).dep);
  vi.doUnmock("./dep.js");
  mock.module("./dep.js", () => ({ dep: "third mock" }));
  console.log("SAID", read());
});
