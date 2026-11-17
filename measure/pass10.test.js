import { expect, test } from "bun:test";
const d = new Date(0);
const received = { k0: 0, k1: 1, k2: 2, k3: 3, a: d, k4: 4, k5: 5, k6: 6, b: d, k7: 7 };
const expected = { k0: 0, k1: 1, k2: 2, k3: 3, a: expect.any(Date), k4: 4, k5: 5, k6: 6, b: expect.any(Date), k7: 7 };
test("pass10", () => {
  for (let i = 0; i < 300; i++) expect(received).toMatchObject(expected);
});
