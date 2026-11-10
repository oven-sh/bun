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

// The require answers the original, which is loaded there; the calls in flight find it loaded. Behind the end of the mock the file itself is loaded for the first time.
test("the body runs at the require, and once more behind the end of the mock", async () => {
  let calls = 0;
  vi.doMock("./part.mjs", async original => {
    calls++;
    return { ...(await original()), mocked: 1 };
  });
  const held = [import("./part.mjs"), import("./part.mjs")];
  console.log("the require:", asked(pull), "|", "calls", calls, "|", bodies());
  const [one, two] = await Promise.all(held.map(load => load.catch(error => error)));
  console.log("the calls:", told(one), "|", told(two), "| one object:", one === two, "|", "calls", calls, "|", bodies());
  vi.doUnmock("./part.mjs");
  console.log("behind the end:", told(await import("./part.mjs").catch(error => error)), "|", "calls", calls, "|", bodies());
});
