import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "bun:test";
const settle = async () => {
  for (let i = 0; i < 5; i++) {
    Bun.gc(true);
    await new Promise(resolve => setTimeout(resolve, 1));
  }
};
const makeFixture = seed => new Uint8Array(1 << 20).fill(seed & 255);
const refs = [];
let user;
beforeEach(async () => {
  const fixture = makeFixture(refs.length);
  refs.push(new WeakRef(fixture));
  vi.doMock("./store.mjs", () => ({ all: () => fixture, find: at => fixture[at] }));
  user = await import("./user.mjs");
});
afterEach(() => {
  vi.doUnmock("./store.mjs");
});
for (let i = 0; i < 200; i++) {
  test("case " + i, () => {
    expect(user.count()).toBe(1048576);
  });
}
test("the end", async () => {
  await settle();
  console.log("SAID without a reset", refs.length, refs.filter(ref => ref.deref() !== undefined).length <= 20 ? "few" : "many");
}, 60000);
