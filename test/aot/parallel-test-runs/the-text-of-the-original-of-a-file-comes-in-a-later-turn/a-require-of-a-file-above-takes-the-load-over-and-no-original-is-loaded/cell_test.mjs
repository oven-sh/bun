import { test, vi } from "bun:test";
import pull from "./pull.cjs";

const told = it => (it instanceof Error ? (it.message.startsWith("refused") ? it.message : [it.name, it.code, JSON.stringify(it.message.split(" imported from ")[0])].join(" ")) : "came " + Object.keys(it).join());
const asked = call => {
  try {
    return told(call());
  } catch (error) {
    return "threw " + told(error);
  }
};
const bodies = () => "bodies " + String(globalThis.timesRun);

// The file above imports the mocked file by a statement: the require loads that graph at once, the factory is called for it, and the calls in flight share what it has loaded.
test("the body of the file never runs", async () => {
  let calls = 0;
  vi.doMock("./part.mjs", original => {
    calls++;
    return { mocked: 1 };
  });
  const held = [import("./part.mjs"), import("./part.mjs")];
  console.log("the require:", asked(pull), "|", "calls", calls, "|", bodies());
  const [one, two] = await Promise.all(held.map(load => load.catch(error => error)));
  console.log("the calls:", told(one), "|", told(two), "| one object:", one === two, "|", "calls", calls, "|", bodies());
  console.log("later:", told(await import("./part.mjs").catch(error => error)), "|", "calls", calls, "|", bodies());
});
