import { expect, jest, test, vi } from "bun:test";
import { use } from "./user.mjs";
test("at once", () => {
  console.log("SAID", use());
  jest.doMock("./util.mjs");
  console.log("SAID", use());
});
test("later", async () => {
  await new Promise(done => setTimeout(done, 20));
  console.log("SAID", use());
});
