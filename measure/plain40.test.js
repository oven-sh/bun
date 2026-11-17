import { expect, test } from "bun:test";
const received = {};
for (let i = 0; i < 40; i++) received["k" + i] = i;
const expected = { ...received };
test("plain40", () => {
  for (let i = 0; i < 300; i++) expect(received).toMatchObject(expected);
});
