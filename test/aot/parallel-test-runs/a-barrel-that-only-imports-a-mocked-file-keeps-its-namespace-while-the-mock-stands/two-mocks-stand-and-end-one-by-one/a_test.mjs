import { test, vi } from "bun:test";
const say = all => Object.keys(all).sort().map(key => key + "=" + (typeof all[key] === "function" ? all[key]() : String(all[key]))).join();
test("the namespace that the test holds", async () => {
  const held = await import("./shelf.mjs");
  vi.doMock("./lamp.mjs", () => ({ lamp: 10 }));
  console.log("SAID laid lamp.mjs", say(await import("./lamp.mjs")));
  vi.doMock("./vase.mjs", () => ({ vase: 20 }));
  console.log("SAID laid vase.mjs", say(await import("./vase.mjs")));
  console.log("SAID both stand", (await import("./shelf.mjs")) === held, say(await import("./shelf.mjs")), "|", say(held));
  vi.doUnmock("./lamp.mjs");
  console.log("SAID one stands", (await import("./shelf.mjs")) === held, say(await import("./shelf.mjs")), "|", say(held));
  vi.doUnmock("./vase.mjs");
  console.log("SAID none stands", (await import("./shelf.mjs")) === held, say(await import("./shelf.mjs")), "|", say(held));
});
