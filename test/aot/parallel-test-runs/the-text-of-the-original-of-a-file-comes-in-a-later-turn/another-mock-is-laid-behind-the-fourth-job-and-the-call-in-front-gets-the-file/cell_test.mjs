import { test, vi } from "bun:test";

const told = it => (it instanceof Error ? [it.name, it.code].join(" ") : "came " + Object.keys(it).join());

// The load of the call behind the mock has failed. The mock that is laid then takes the failed load out, so the call in front finds none when its text has come, and gets the file.
test("the call behind has failed alone", async () => {
  const front = import("./part.mjs");
  vi.doMock("./part.mjs", async original => ({ ...(await original()), added: 1 }));
  const behind = import("./part.mjs").catch(error => error);
  vi.doUnmock("./part.mjs");
  for (let job = 0; job < 6; job++) await 0;
  vi.doMock("./part.mjs", () => ({ second: 2 }));
  const [one, two] = await Promise.all([front.catch(error => error), behind]);
  console.log("in front:", told(one), "| behind:", told(two), "| bodies", String(globalThis.timesRun));
  console.log("later is what the call in front got:", (await import("./part.mjs")) === one);
});
