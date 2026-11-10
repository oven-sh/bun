import { mock, test, vi } from "bun:test";
const say = () => import("./slow.mjs").then(held => held.get(), error => error.message);
const begun = new Promise(tell => { globalThis.tellThatBodyHasBegun = tell; });
test("t", async () => {
  const first = import("./user.mjs").then(held => held.seen);
  await begun;
  vi.doMock("./slow.mjs", () => ({ get: () => "mocked" }));
  const second = say();
  console.log("| " + (await first) + " | " + (await second) + " | " + (await import("./user.mjs")).seen);
});
