import { jest, test } from "bun:test";
import { send } from "./barrel.ts";

test("sees the mock behind the call", async () => {
  console.log("b", send());
  jest.mock("./barrel.ts", () => ({ send: () => "mocked" }));
  console.log("b", send(), require("./barrel.ts").send(), (await import("./barrel.ts")).send());
});
