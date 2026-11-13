import { jest, mock, test, vi } from "bun:test";
test("a", () => {
  console.log("a", require("./dep.mjs").name);
  vi.doMock("./dep.mjs", async () => ({ ...(await vi.importActual("./dep.mjs")), name: "never loaded" }));
});
test("b", async () => {
  mock.module("./dep.mjs", () => ({ name: "first" }));
  mock.module("./dep.mjs", () => ({ name: "second" }));
  console.log("b", (await import("./dep.mjs")).name);
  await mock.module("./dep.mjs", async () => {
    console.log("third");
    return { ...(await vi.importActual("./dep.mjs")), name: "third" };
  });
  console.log("behind", require("./dep.mjs").name);
});
