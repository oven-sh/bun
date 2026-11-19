import { jest, mock, test, vi } from "bun:test";
import { read } from "./user.mjs";
test("a", async () => {
  mock.module("./dep.mjs", async () => {
    await new Promise(() => {});
    return { a: "mock" };
  });
  console.log("SAID a", read());
  vi.doUnmock("./dep.mjs");
  console.log("SAID again", (await import("./user.mjs")).read());
});
