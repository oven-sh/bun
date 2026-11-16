import { mock, test, vi } from "bun:test";
const say = () => import("./slow.mjs").then(held => held.get(), error => error.message);
const begun = new Promise(tell => { globalThis.tellThatBodyHasBegun = tell; });
test("t", async () => {
  const first = say();
  await begun;
  vi.doMock("./slow.mjs", () => ({ get: () => "mocked" }));
  console.log("| " + (await first) + " | " + (await say()) + " | " + (await say()));
});
