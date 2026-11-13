import { test, vi } from "bun:test";
const say = () => import("./slow.mjs").then(held => held.get(), error => error.message);
test("t", async () => {
  const first = say();
  await 0;
  vi.doMock("./slow.mjs", () => ({ get: () => "mocked" }));
  console.log("| " + (await first) + " | " + (await say()) + " | " + (await say()));
});
