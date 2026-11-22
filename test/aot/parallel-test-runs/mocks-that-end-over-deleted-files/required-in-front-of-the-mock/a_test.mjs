import { mock, test, vi } from "bun:test";
import * as mail from "./mail.cjs";
test("another mock ends it", async () => {
  console.log("first", require("./mail.cjs").send());
  mock.module("./mail.cjs", () => ({ send: () => "stub" }));
  delete require.cache[require.resolve("./mail.cjs")];
  vi.doMock("./mail.cjs", () => ({ send: () => "mocked" }));
  console.log("ended", mail.send(), (await import("./mail.cjs")).send());
});
