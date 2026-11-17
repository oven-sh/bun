import { expect, test } from "bun:test";
const p = Promise.resolve(1);
const received = { a: p };
const expected = { a: expect.resolvesTo.any(Number) };
test("resolvesTo matcher asked by toEqual", async () => {
  await p;
  for (let i = 0; i < 300; i++) expect(received).toEqual(expected);
});
