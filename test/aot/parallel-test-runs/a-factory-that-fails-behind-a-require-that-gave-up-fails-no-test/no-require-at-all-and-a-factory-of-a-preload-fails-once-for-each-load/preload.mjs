import { vi } from "bun:test";
globalThis.calls = 0;
globalThis.gates = [];
globalThis.firstCall = new Promise(heard => (globalThis.tellOfFirstCall = heard));
vi.mock("./wick.mjs", async () => {
  const call = ++globalThis.calls;
  if (call > 8) return { width: "ninth" };
  globalThis.tellOfFirstCall();
  if (globalThis.holdsFactories) await new Promise(open => globalThis.gates.push(open));
  else await new Promise(done => setTimeout(done, 1));
  throw new Error("fails " + call);
});
