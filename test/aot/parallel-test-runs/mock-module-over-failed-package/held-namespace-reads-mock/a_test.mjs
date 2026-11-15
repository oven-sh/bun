import { mock, test, vi } from "bun:test";
let calls = 0;
const say = (at, value) => console.log(at, value, "| shelved", globalThis.shelved.heat, "and", globalThis.shelved.kiln.heat, "| firings", globalThis.firings, "| calls", calls);
const load = () => import("@made-up/kiln").then(kiln => kiln.heat, error => error.message);
test("a namespace that was kept reads the mock at once", async () => {
  say("first", await load());
  mock.module("@made-up/kiln", () => (calls++, { heat: "mock" }));
  say("mocked", "-");
  say("imported", await load());
});
