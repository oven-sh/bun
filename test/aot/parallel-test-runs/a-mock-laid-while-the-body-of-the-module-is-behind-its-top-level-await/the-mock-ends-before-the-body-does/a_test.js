import { mock, test, vi } from "bun:test";
const say = () => import("./slow.mjs").then(held => held.get(), error => error.message);
const begun = new Promise(tell => { globalThis.tellThatBodyHasBegun = tell; });
test("t", async () => {
  const first = say();
  await begun;
  vi.doMock("./slow.mjs", () => ({ get: () => "mocked" }));
  const second = await say();
  vi.doUnmock("./slow.mjs");
  const third = say();
  console.log("| " + (await first) + " | " + second + " | " + (await third));
});
