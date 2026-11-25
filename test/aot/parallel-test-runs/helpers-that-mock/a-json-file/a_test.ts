import { expect, test } from "bun:test";
import { mocked } from "./helper.ts";
import settings from "./settings.json";

test("the test file reads the file that its graph has parsed", () => {
  expect(mocked).toBe("mock");
  console.log("SAID", JSON.stringify(settings));
});
