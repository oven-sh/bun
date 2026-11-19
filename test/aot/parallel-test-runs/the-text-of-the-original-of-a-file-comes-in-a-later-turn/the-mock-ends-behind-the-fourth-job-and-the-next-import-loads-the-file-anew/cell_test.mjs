import { test, vi } from "bun:test";

// The load in flight goes on to the original, and what was loading when the mock ended goes out once it is loaded: the next import runs the body again and gets another namespace.
test("the body runs once for the call and once for the next import", async () => {
  vi.doMock("./part.mjs", async original => ({ ...(await original()), added: 1 }));
  const load = import("./part.mjs");
  for (let job = 0; job < 4; job++) await 0;
  vi.doUnmock("./part.mjs");
  const first = await load;
  console.log("the call:", Object.keys(first).join(), "| bodies", globalThis.timesRun);
  const next = await import("./part.mjs");
  console.log("the next import:", Object.keys(next).join(), "| the same namespace:", next === first, "| bodies", globalThis.timesRun);
});
