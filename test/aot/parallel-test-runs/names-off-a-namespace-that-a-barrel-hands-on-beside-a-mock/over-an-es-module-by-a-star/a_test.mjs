import { test, vi } from "bun:test";
test("t", async () => {
  await import("./stars.mjs");
  vi.doMock("./rates.mjs", () => ({ rate: "the rate of the mock", show: () => "shown by the mock" }));
  console.log((await import("./two.mjs")).shown());
  const own = await import("./own.mjs");
  console.log(own.byName(), "|", own.off(), "|", own.byKey("rate"), "|", own.same(), "|", own.called(), "|", own.required());
});
