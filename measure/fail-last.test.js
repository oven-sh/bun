import { expect, test } from "bun:test";
const received = { k1: 1, k2: 2, k3: 3, k4: 4, k5: 5, k6: 6, k7: 7, k8: 8, k9: 9, a: "foobar" };
const n = expect.any(Number);
const expected = { k1: n, k2: n, k3: n, k4: n, k5: n, k6: n, k7: n, k8: n, k9: n, a: expect.any(Date) };
test("fail-last", () => {
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
