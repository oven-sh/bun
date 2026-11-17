import { expect, test } from "bun:test";
const received = { a: 1, b: 2, c: "hello" };
const expected = { a: 1, b: 2, c: "hello" };
test("plain3", () => {
  for (let i = 0; i < 300; i++) expect(received).toMatchObject(expected);
});
