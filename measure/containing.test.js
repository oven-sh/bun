import { expect, test } from "bun:test";
const d = new Date(0);
const received = [{ a: d, b: 1 }];
const expected = [expect.objectContaining({ a: expect.any(Date) })];
test("containing", () => {
  for (let i = 0; i < 300; i++) expect(received).toEqual(expected);
});
