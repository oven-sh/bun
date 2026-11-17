import { expect, test } from "bun:test";
expect.extend({
  toBeOddNumber(received) {
    return { pass: received % 2 === 1, message: () => "" };
  },
});
test("custom symmetric", () => {
  for (let i = 0; i < 300; i++) expect(3).toBeOddNumber();
});
