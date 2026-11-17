import { expect, test } from "bun:test";
const p = Promise.resolve(1);
const received = { a: p, b: 2 };
const expected = { a: expect.resolvesTo.any(Number), b: 2 };
test("resolvesTo matcher asked by toMatchObject", async () => {
  await p;
  for (let i = 0; i < 300; i++) expect(received).toMatchObject(expected);
});
