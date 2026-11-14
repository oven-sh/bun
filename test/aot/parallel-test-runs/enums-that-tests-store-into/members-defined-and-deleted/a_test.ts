import { test } from "bun:test";
import { Kind } from "./kinds";
import { all } from "./use";
test("a getter in the place of a member", () => {
  let asked = 0;
  Object.defineProperty(Kind, "First", { get: () => 10 + asked++, configurable: true, enumerable: true });
  console.log("SAID", all(1), asked);
});
test("a member that is gone", () => {
  delete (Kind as any).First;
  console.log("SAID", all(undefined), "First" in Kind, Object.keys(Kind).join());
});
test("members laid over it", () => {
  Object.assign(Kind, { First: 7, Second: 8 });
  console.log("SAID", all(8), all(7));
});
