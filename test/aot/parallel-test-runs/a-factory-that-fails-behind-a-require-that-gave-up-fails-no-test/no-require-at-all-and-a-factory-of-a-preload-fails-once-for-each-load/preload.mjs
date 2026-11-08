import { vi } from "bun:test";
globalThis.calls = 0;
vi.mock("./wick.mjs", async () => {
  const call = ++globalThis.calls;
  if (call > 8) return { width: "ninth" };
  await new Promise(done => setTimeout(done, 40));
  throw new Error("fails " + call);
});
