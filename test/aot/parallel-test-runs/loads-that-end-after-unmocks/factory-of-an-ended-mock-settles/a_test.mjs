import { test, vi } from "bun:test";
const attempt = load => {
  try {
    return load().seen();
  } catch (error) {
    return error.name;
  }
};
test("a", async () => {
  const { promise, resolve } = Promise.withResolvers();
  vi.doMock("./dep.mjs", () => promise);
  console.log("first", attempt(() => require("./user.mjs")));
  vi.doUnmock("./dep.mjs");
  console.log("second", attempt(() => require("./user.mjs")));
  resolve({ value: "late" });
  await new Promise(done => setImmediate(done));
  console.log("third", attempt(() => require("./user.mjs")));
});
