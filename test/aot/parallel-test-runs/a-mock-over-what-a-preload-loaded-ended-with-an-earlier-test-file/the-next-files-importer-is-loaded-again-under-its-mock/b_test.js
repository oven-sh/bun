import { mock, test, vi } from "bun:test";
import { read } from "./reader.js";
test("b", async () => {
  vi.doMock("./dep.cjs", () => ({ dep: "second mock" }));
  console.log("SAID", (await import("./dep.cjs")).dep);
  console.log("SAID", (await import("./reader.js")).read());
});
