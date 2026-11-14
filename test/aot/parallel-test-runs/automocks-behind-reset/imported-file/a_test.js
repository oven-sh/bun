import { test, vi, beforeEach } from "bun:test";
import { value } from "./dep.cjs";
vi.mock("./dep.cjs", () => ({ value: () => "hoisted", other: "of hoisted" }));
beforeEach(() => {
  vi.resetModules();
});
test("automock", async () => {
  vi.doMock("./dep.cjs");
  console.log(value(), (await import("./sub.cjs")).read());
});
