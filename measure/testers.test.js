import { expect, test } from "bun:test";
expect.addEqualityTesters([(a, b) => undefined]);
const d = new Date(0);
const received = { a: d, b: { c: 1, d: "x" }, c: "hello" };
const expected = { a: expect.any(Date), b: { c: 1, d: "x" }, c: "hello" };
test("testers", () => {
  for (let i = 0; i < 300; i++) expect(received).toMatchObject(expected);
});
