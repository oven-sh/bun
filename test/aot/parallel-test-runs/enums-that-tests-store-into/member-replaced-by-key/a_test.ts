import { expect, jest, test } from "bun:test";
import { Kind } from "./kinds";
import { all } from "./use";
function replace(target: any, key: string, value: unknown) {
  const before = target[key];
  target[key] = value;
  return () => {
    target[key] = before;
  };
}
test("a helper replaces a member and puts it back", () => {
  const restore = replace(Kind, "First", 40);
  console.log("SAID", all(1), all(40));
  expect(Kind.First as number).toBe(40);
  restore();
  console.log("SAID", all(1));
});
test("jest replaces nothing that nobody replaced", () => {
  jest.restoreAllMocks();
  console.log("SAID", all(2));
});
