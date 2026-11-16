import { test, vi } from "bun:test";

const told = it => (it instanceof Error ? [it.name, it.code, JSON.stringify(it.message.split(" imported from ")[0])].join(" ") : "came " + Object.keys(it).join());

const behind = async (path, jobs) => {
  vi.doMock(path, async original => ({ ...(await original()), added: 1 }));
  const load = import(path);
  for (let job = 0; job < jobs; job++) await 0;
  vi.doUnmock(path);
  return told(await load.catch(error => error));
};

// From the fourth job on the load in flight has asked for the original of the file: it goes on and gets the file itself.
test("the fourth job decides", async () => {
  console.log("three jobs:", await behind("./early.mjs", 3), "| bodies", String(globalThis.timesRun));
  console.log("four jobs:", await behind("./late.mjs", 4), "| bodies", String(globalThis.timesRun));
});
