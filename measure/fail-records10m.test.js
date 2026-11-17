import { expect, test } from "bun:test";
const rec = i => ({ id: i, name: "user" + i, tags: ["a", "b", "c"], owner: { id: i % 7, name: "o" + (i % 7), address: { city: "x", zip: "12345" } }, active: true, score: i * 1.5 });
const received = { status: 500, when: 1, items: Array.from({ length: 10 }, (_, i) => rec(i)) };
const expected = { status: 200, when: expect.any(Number), items: Array.from({ length: 10 }, (_, i) => rec(i)) };
test("fail-records10m", () => {
  for (let i = 0; i < 300; i++) {
    let threw = false;
    try {
      expect(received).toMatchObject(expected);
    } catch {
      threw = true;
    }
    if (!threw) throw new Error("did not throw");
  }
});
