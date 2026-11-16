import { test } from "bun:test";

const told = it => (it instanceof Error ? [it.name, it.code, JSON.stringify(it.message.split(" imported from ")[0])].join(" ") : "came " + Object.keys(it).join());

// The load that failed went with the mocks of the file that made it.
test("the call failed and a later import gets the file", async () => {
  console.log("the call:", told(await globalThis.behind.catch(error => error)), "| bodies", String(globalThis.timesRun));
  console.log("later:", told(await import("./part.mjs").catch(error => error)), "| bodies", String(globalThis.timesRun));
});
