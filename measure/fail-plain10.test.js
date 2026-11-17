import { expect, test } from "bun:test";
const received = { k0: 0, k1: 1, k2: 2, k3: 3, k4: 4, k5: 5, k6: 6, k7: 7, k8: 8, k9: 9 };
const expected = { k0: 0, k1: 1, k2: 2, k3: 3, k4: 4, k5: 5, k6: 6, k7: 7, k8: 8, k9: "other" };
test("fail-plain10", () => {
  let failed = 0;
  for (let i = 0; i < 300; i++) {
    try {
      expect(received).toMatchObject(expected);
    } catch {
      failed++;
    }
  }
  expect(failed).toBe(300);
});
