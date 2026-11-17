import { expect, test } from "bun:test";
expect.extend({
  toBeOddNumber(received) {
    return { pass: received % 2 === 1, message: () => "" };
  },
});
const matcher = expect.toBeOddNumber();
test("custom direct asymmetricMatch (under a barrier)", () => {
  let passed = 0;
  for (let i = 0; i < 300; i++) if (matcher.asymmetricMatch(3)) passed++;
  expect(passed).toBe(300);
});
