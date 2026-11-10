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

// The require loads nothing: the factory is not one that awaits, so it is called there. The load in flight comes to the original later, though the mock has settled by then, and calls no factory.
test("the body of the file runs for the calls and not for the require", async () => {
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
