import { expect, test } from "bun:test";
expect.extend({
  toBeOddNumber(received) {
    return { pass: received % 2 === 1, message: () => "" };
  },
});
const received = { a: 1, b: 3 };
const expected = { a: expect.toBeOddNumber(), b: expect.toBeOddNumber() };
test("custom", () => {
  for (let i = 0; i < 300; i++) expect(received).toEqual(expected);
});
