import { test, vi } from "bun:test";
test("the hub under the mock and behind its end", async () => {
  let user;
  vi.doMock("kit/first.mjs", () => ({ one: 10, added: 3 }));
  console.log("SAID the mock", Object.keys(await import("kit/first.mjs")).sort().join());
  try {
    user ??= await import("./user.mjs");
    console.log("SAID under", user.look());
  } catch (error) {
    console.log("SAID under", error.constructor.name);
  }
  vi.doUnmock("kit/first.mjs");
  try {
    user ??= await import("./user.mjs");
    console.log("SAID ended", user.look());
  } catch (error) {
    console.log("SAID ended", error.constructor.name);
  }
});
