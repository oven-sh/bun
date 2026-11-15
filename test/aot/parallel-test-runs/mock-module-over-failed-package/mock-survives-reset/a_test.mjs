import { mock, test, vi } from "bun:test";
let calls = 0;
const say = (at, value) => console.log(at, value, "| shelved", globalThis.shelved.heat, "| firings", globalThis.firings, "| calls", calls);
const load = () => import("@made-up/kiln").then(kiln => kiln.heat, error => error.message);
test("the mock outlives a reset and the body does not run again", async () => {
  say("first", await load());
  mock.module("@made-up/kiln", () => (calls++, { heat: "mock" }));
  say("mocked", "-");
  vi.resetModules();
  say("reset", "-");
  say("imported", await load());
});
