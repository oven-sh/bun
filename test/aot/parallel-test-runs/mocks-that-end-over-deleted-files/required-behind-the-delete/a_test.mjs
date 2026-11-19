import { mock, test, vi } from "bun:test";
import * as mail from "./mail.cjs";
import { send } from "./mail.cjs";
test("the mock ends", () => {
  mock.module("./mail.cjs", () => ({ send: () => "stub" }));
  delete require.cache[require.resolve("./mail.cjs")];
  console.log("required", require("./mail.cjs").send(), send(), mail.send());
  vi.doUnmock("./mail.cjs");
  console.log("ended", send(), mail.send());
});
