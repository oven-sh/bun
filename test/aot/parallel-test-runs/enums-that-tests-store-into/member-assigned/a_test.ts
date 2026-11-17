import { afterAll, expect, test } from "bun:test";
import { Kind, own } from "./kinds";
import { all } from "./use";
test("a member that a test assigns", () => {
  console.log("SAID", all(1), own());
  (Kind as any).First = "stored";
  console.log("SAID", all(1), all("stored"), Kind.First, own());
  expect(Kind.First as any).toBe("stored");
});
test("the next test", () => {
  console.log("SAID", all(1), Kind.First);
});
afterAll(() => {
  (Kind as any).First = 1;
  console.log("SAID", all(1));
});
