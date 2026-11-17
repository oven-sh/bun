import { expect, test } from "bun:test";
const d = new Date(0);
const received = { a: "foobar", b: d, c: "hello" };
const expected = { a: expect.any(Date), b: expect.any(Date), c: "hello" };
test("fail-repro", () => {
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
