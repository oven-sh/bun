import { test, vi } from "bun:test";

const told = it => (it instanceof Error ? [it.name, it.code, JSON.stringify(it.message.split(" imported from ")[0])].join(" ") : "came " + Object.keys(it).join());

// The load in flight has not asked for the original yet. It fails, the body of the file never runs, and the failure is kept: every call and a later import get one error object.
test("two calls and a later import get one error", async () => {
  vi.doMock("./part.mjs");
  const loads = [import("./part.mjs"), import("./part.mjs")];
  vi.doUnmock("./part.mjs");
  const [one, two] = await Promise.all(loads.map(load => load.catch(error => error)));
  console.log(told(one), "|", told(two), "| one object:", one === two);
  const later = await import("./part.mjs").catch(error => error);
  console.log("later", told(later), "| the same object:", later === one, "| bodies", String(globalThis.timesRun));
});
