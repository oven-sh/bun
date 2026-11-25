import { test, vi, mock, jest } from "bun:test";
test("b", async () => {
  console.log("SAID b first", (await import("./user.js")).viaUser(), (await import("./later.js")).viaLater());
  vi.doMock("./dep.js", () => ({ who: "second" }));
  console.log("SAID b behind", (await import("./user.js")).viaUser(), (await import("./later.js")).viaLater(), (await import("./dep.js")).who);
});
