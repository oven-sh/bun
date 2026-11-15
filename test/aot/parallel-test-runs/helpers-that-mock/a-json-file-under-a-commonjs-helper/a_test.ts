import { expect, test } from "bun:test";
import { sent } from "./helper.cjs";
import settings from "./settings.json";

test("the default import is the object of the file", async () => {
  expect(sent("ann")).toBe("mock ann");
  console.log("SAID", JSON.stringify(settings));
  console.log("SAID", (await import("./settings.json")).name);
});
