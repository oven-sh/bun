import { mock, test, vi, jest } from "bun:test";
import { get } from "./part.mjs";
test("t", async () => {
  vi.doMock("./part.mjs", () => ({ get: () => 5 }));
  console.log("SAID under", (await import("./part.mjs")).get(), get());
  mock.restore();
  vi.doUnmock("./part.mjs");
  mock.module("./part.mjs", () => ({ get: () => 7 }));
  console.log("SAID behind", get(), (await import("./part.mjs")).get(), get());
});
