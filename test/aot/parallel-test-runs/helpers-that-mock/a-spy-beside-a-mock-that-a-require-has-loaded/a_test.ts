import { expect, test, vi } from "bun:test";
import { sent } from "./helper.cjs";
import * as mail from "./mail.ts";

test("a spy on the namespace of an import, beside a mock that a require() has loaded", () => {
  expect(typeof mail.send("ann")).toBe("string");
  expect(sent("bob")).toBe("mock bob");
  vi.doMock("./mail.ts", () => ({ send: (to: string) => "second " + to }));
  expect(require("./mail.ts").send("cid")).toBe("second cid");
  vi.spyOn(mail, "send").mockReturnValue("spied");
  expect(mail.send("fay")).toBe("spied");
});
