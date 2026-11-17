import { expect, test } from "bun:test";
const d = new Date(0);
const received = [{ a: "1" }, { a: "2" }, { a: "3" }, { a: "4" }, { a: "5" }, { a: "6" }, { a: "7" }, { a: "8" }, { a: d }];
const expected = expect.objectContaining({ a: expect.any(Date) });
test("miss", () => {
  for (let i = 0; i < 300; i++) expect(received).toContainEqual(expected);
});
