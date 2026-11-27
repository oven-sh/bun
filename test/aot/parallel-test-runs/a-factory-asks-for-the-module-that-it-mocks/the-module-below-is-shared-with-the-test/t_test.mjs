import { mock, test } from "bun:test";
mock.module("./other.mjs", () => ({ who: "mock other" }));
mock.module("./dep.mjs", async () => ({ ...(await import("./dep.mjs")), extra: 1 }));
test("t", async () => { const dep = await import("./dep.mjs"), low = await import("./low.mjs"); console.log("|", dep.first, dep.sees, dep.keys, dep.extra, dep.count, low.bump(), low.count);
  mock.restore(); const again = await import("./dep.mjs"); console.log("|", again.extra, again.first, low.count); });
