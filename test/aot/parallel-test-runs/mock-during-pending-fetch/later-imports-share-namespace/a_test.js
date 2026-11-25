import { test, vi } from "bun:test";
const say = () => import("./slow.mjs").then(held => held.get(), error => error.message);
test("t", async () => {
  const first = import("./slow.mjs");
  await 0;
  vi.doMock("./slow.mjs", () => ({ get: () => "mocked" }));
  const held = await first;
  console.log("| " + held.get() + " | " + (await say()) + " | " + held.get() + " " + (held === await import("./slow.mjs")));
});
