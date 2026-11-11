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

// An async function without an await is called by the require as any other.
test("the body of the file has run when the call has come", async () => {
  let calls = 0;
  vi.doMock("./part.mjs", async original => {
    calls++;
    return { mocked: 1 };
  });
  const held = [import("./part.mjs")];
  console.log("the require:", asked(pull), "|", "calls", calls, "|", bodies());
  console.log("the call:", told(await held[0].catch(error => error)), "|", "calls", calls, "|", bodies());
});
