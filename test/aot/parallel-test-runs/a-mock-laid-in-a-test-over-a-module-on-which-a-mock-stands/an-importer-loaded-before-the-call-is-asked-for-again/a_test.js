import { test, vi } from "bun:test";
test("t", async () => {
  console.log("SAID asked first", (await import("./user.js")).viaUser());
  vi.doMock("./dep.js", () => ({ who: "later" }));
  console.log("SAID asked again", (await import("./user.js")).viaUser());
});
