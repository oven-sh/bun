import { mock, test, vi } from "bun:test";
let calls = 0;
const say = (at, value) => console.log(at, value, "| shelved", globalThis.shelved.heat, "| firings", globalThis.firings, "| calls", calls);
const load = () => import("@made-up/kiln").then(kiln => kiln.heat, error => error.message);
test("the factory is called at the mock call", async () => {
  say("first", await load());
  mock.module("@made-up/kiln", () => (calls++, { heat: "mock" }));
  say("mocked", "-");
  say("imported", await load());
  say("required", require("@made-up/kiln").heat);
});
