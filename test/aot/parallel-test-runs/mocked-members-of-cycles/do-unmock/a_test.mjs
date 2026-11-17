import { mock, test, vi } from "bun:test";

test("a member of the cycle is mocked over the loaded module", async () => {
  const { a } = await import("./a.mjs");
  a();
  mock.module("./b.mjs", () => ({ b: () => "m" }));
  console.log("SAID one", a());
  vi.doUnmock("./b.mjs");
  console.log("SAID again", a(), (await import("./a.mjs")).a(), (await import("./b.mjs")).both());
});
