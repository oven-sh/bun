import { test, vi } from "bun:test";
const say = all => Object.keys(all).sort().map(key => key + "=" + all[key]).join();
test("the namespace of the barrel", async () => {
  await import("./clock.mjs");
  vi.doMock("./kit/shapes.mjs", () => ({ round: 100 }));
  const under = await import("./kit/wide.mjs");
  console.log("under", say(under));
  vi.doMock("./clock.mjs", () => ({ ticks: 100 }));
  console.log("held", (await import("./clock.mjs")).ticks);
  vi.doUnmock("./kit/shapes.mjs");
  const behind = await import("./kit/wide.mjs");
  console.log("behind", say(behind));
  vi.doUnmock("./clock.mjs");
  const last = await import("./kit/wide.mjs");
  console.log("last", say(last));
  console.log("the same as behind", behind === last, "the same as under", under === last);
});
