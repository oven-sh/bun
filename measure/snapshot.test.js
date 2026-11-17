import { expect, test } from "bun:test";
const d = new Date(0);
const received = { a: d, b: 1, c: "hello" };
const matchers = { a: expect.any(Date) };
test("snapshot", () => {
  for (let i = 0; i < 300; i++) expect(received).toMatchSnapshot(matchers);
});
