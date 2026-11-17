import { expect, test } from "bun:test";
const subset = { a: 1, b: 2, c: "hello" };
const object = { a: 1, b: 2, c: "hello", d: 4 };
test("deepmatch", () => {
  let all = true;
  for (let i = 0; i < 300; i++) all = Bun.deepMatch(subset, object) && all;
  expect(all).toBe(true);
});
