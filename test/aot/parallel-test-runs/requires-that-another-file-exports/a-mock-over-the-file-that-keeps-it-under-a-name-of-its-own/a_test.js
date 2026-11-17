import { mock, test } from "bun:test";
mock.module("./keeps.js", () => ({ take: (name) => "mocked" }));
test("the mock answers", async () => {
  const { askWhole, askShort } = await import("./asks.js");
  console.log("SAID", askWhole(), "|", askShort());
});
