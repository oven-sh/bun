import { test, vi } from "bun:test";

const told = it => (it instanceof Error ? [it.name, it.code].join(" ") : "came " + Object.keys(it).join());

// The load that failed is kept for a later import. A reset of the modules takes it out with every other module that failed, and the file loads.
test("a later import fails until the modules are reset", async () => {
  vi.doMock("./part.mjs", async original => ({ ...(await original()), added: 1 }));
  const load = import("./part.mjs");
  vi.doUnmock("./part.mjs");
  console.log("the call:", told(await load.catch(error => error)));
  console.log("later:", told(await import("./part.mjs").catch(error => error)), "| bodies", String(globalThis.timesRun));
  vi.resetModules();
  console.log("behind the reset:", told(await import("./part.mjs").catch(error => error)), "| bodies", String(globalThis.timesRun));
});
