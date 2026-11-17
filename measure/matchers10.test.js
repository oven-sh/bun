import { expect, test } from "bun:test";
const received = { k0: 0, k1: 1, k2: 2, k3: 3, k4: 4, k5: 5, k6: 6, k7: 7, k8: 8, k9: 9 };
const n = expect.any(Number);
const expected = { k0: n, k1: n, k2: n, k3: n, k4: n, k5: n, k6: n, k7: n, k8: n, k9: n };
test("matchers10", () => {
  for (let i = 0; i < 300; i++) expect(received).toMatchObject(expected);
});
