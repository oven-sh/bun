import { jest, mock, test, vi } from "bun:test";
mock.module("./data.json", async () => ({ ...(await import("./data.json")), v: "patch" }));
test("a", async () => {
  console.log("a", (await import("./shop.mjs")).shown());
  console.log("actual", jest.requireActual("./data.json").v);
});
