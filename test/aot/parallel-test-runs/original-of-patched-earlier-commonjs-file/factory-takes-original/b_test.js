import { jest, test, vi } from "bun:test";
test("b", async () => {
  jest.mock("./dep.cjs", () => ({ flag: "patched", plain: "patched" }));
  console.log("SAID patched", (await import("./user.js")).user());
  vi.doMock("./dep.cjs", async original => ({ ...(await original()), flag: "mocked" }));
  console.log("SAID mocked", (await import("./user.js")).user());
  vi.doUnmock("./dep.cjs");
  console.log("SAID behind", (await import("./user.js")).user());
});
