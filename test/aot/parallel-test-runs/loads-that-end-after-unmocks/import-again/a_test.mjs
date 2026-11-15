import { test, vi } from "bun:test";
const attempt = load => {
  try {
    return load().seen();
  } catch (error) {
    return error.name;
  }
};
test("a", async () => {
  vi.doMock("./dep.mjs", async () => {
    await new Promise(() => {});
  });
  console.log("first", attempt(() => require("./user.mjs")));
  vi.doUnmock("./dep.mjs");
  console.log("second", (await import("./user.mjs")).seen());
  vi.doMock("./dep.mjs", () => ({ value: "mock" }));
  console.log("third", (await import("./user.mjs")).seen());
});
