import { jest, test } from "bun:test";

test("the next load has the mock", async () => {
  jest.doMock("./barrel.ts", () => ({ send: () => "mocked" }));
  console.log("b", require("./barrel.ts").send(), (await import("./barrel.ts")).send());
});
