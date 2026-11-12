import { test, vi } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// As the next import does, so does a require.
test("the body runs once for the call and once for the require", async () => {
  vi.doMock("./part.mjs", async original => ({ ...(await original()), added: 1 }));
  const load = import("./part.mjs");
  for (let job = 0; job < 4; job++) await 0;
  vi.doUnmock("./part.mjs");
  const first = await load;
  console.log("the call:", Object.keys(first).join(), "| bodies", globalThis.timesRun);
  console.log("the require:", Object.keys(require("./part.mjs")).join(), "| bodies", globalThis.timesRun);
});
