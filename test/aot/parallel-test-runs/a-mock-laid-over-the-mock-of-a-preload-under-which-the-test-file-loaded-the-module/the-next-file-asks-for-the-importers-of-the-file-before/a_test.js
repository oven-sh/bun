import { test, vi } from "bun:test";
test("a", async () => {
  console.log("SAID a first", (await import("./user.js")).viaUser());
  vi.doMock("./dep.js", () => ({ who: "later" }));
  console.log("SAID a behind", (await import("./later.js")).viaLater(), (await import("./user.js")).viaUser());
});
