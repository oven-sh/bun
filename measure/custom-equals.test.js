import { expect, test } from "bun:test";
expect.extend({
  toBeOddNumber(received) {
    return { pass: received % 2 === 1, message: () => "" };
  },
  toEqualThroughEquals(received, pattern) {
    return { pass: this.equals(received, pattern), message: () => "" };
  },
});
const pattern = { a: expect.toBeOddNumber() };
test("custom matcher asked under this.equals (a barrier)", () => {
  for (let i = 0; i < 300; i++) expect({ a: 3 }).toEqualThroughEquals(pattern);
});
