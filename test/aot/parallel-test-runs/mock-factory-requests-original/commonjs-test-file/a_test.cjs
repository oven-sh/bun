const { test, jest } = require("bun:test");
test("whether the mocked file runs", async () => {
  jest.doMock("./own", () => {
    globalThis.ran = (globalThis.ran ?? "") + "factory,";
    return { ...jest.requireActual("./own"), value: "mock" };
  });
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
