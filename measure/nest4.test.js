import { expect, test } from "bun:test";
const received = { a: { x: 1 }, b: { y: 2 }, c: { z: { w: 3 } }, d: 4 };
const expected = { a: { x: 1 }, b: { y: 2 }, c: { z: { w: 3 } }, d: 4 };
test("nest4", () => {
  for (let i = 0; i < 300; i++) expect(received).toMatchObject(expected);
});
