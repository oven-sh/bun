import { test, vi } from "bun:test";
test("the load", async () => {
  const got = load => load.then(names => "loaded " + JSON.stringify(names), error => error.name);
  console.log("SAID", await got(import("./door.mjs")));
  vi.doMock("./tally.mjs", () => ({ tally: "mock" }));
  console.log("SAID", await got(import("./door.mjs")));
});
