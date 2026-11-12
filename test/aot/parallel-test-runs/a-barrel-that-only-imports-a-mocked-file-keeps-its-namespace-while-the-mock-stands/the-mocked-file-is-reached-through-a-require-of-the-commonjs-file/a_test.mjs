import { test, vi } from "bun:test";
const say = all => Object.keys(all).sort().map(key => key + "=" + (typeof all[key] === "function" ? all[key]() : String(all[key]))).join();
test("the namespace that the test holds", async () => {
  const held = await import("./shelf.mjs");
  vi.doMock("./vase.cjs", () => ({ vase: 20 }));
  console.log("SAID laid", say(await import("./vase.cjs")));
  console.log("SAID it stands", (await import("./shelf.mjs")) === held, say(await import("./shelf.mjs")), "|", say(held));
  vi.doUnmock("./vase.cjs");
  console.log("SAID none stands", (await import("./shelf.mjs")) === held, say(await import("./shelf.mjs")), "|", say(held));
});
