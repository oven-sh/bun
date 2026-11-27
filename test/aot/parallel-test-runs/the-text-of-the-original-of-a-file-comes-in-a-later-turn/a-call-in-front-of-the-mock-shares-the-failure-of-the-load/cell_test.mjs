import { test, vi } from "bun:test";

const told = it => (it instanceof Error ? [it.name, it.code, JSON.stringify(it.message.split(" imported from ")[0])].join(" ") : "came " + Object.keys(it).join());

// The call in front of the mock looks the file up again when its text has come, and finds the load that failed.
test("both calls get one error", async () => {
  const front = import("./part.mjs");
  vi.doMock("./part.mjs", async original => ({ ...(await original()), added: 1 }));
  const behind = import("./part.mjs");
  vi.doMock("./part.mjs", () => ({ second: 2 }));
  const [one, two] = await Promise.all([front, behind].map(load => load.catch(error => error)));
  console.log("in front:", told(one), "| behind:", told(two), "| one object:", one === two, "| bodies", String(globalThis.timesRun));
});
