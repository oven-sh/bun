import { test, vi } from "bun:test";
const got = load => load.then(names => "loaded " + JSON.stringify(names), error => error.name);
test("the load", async () => {
  const first = import("./door.mjs"); console.log("SAID", await got(first));
  vi.doMock("./between.mjs", () => ({ between: "mock" }));
  const second = import("./door.mjs"); console.log("SAID", await got(second));
  const [a, b] = await Promise.all([first, second].map(load => load.catch(error => error)));
  console.log("SAID same", a === b);
  console.log("SAID count " + String(globalThis.bodies));
  vi.doUnmock("./between.mjs");
});
