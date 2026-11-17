import { expect, test } from "bun:test";
const d = new Date(0);
const received = { a: "foobar", b: d, c: "hello" };
const expected = { a: expect.any(Date), b: expect.any(Date), c: "hello" };
test("not3", () => {
  for (let i = 0; i < 300; i++) expect(received).not.toMatchObject(expected);
});
