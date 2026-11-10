import { test, vi } from "bun:test";
test("the errors", async () => {
  const got = load => load.then(() => "loaded", error => error);
  await got(import("./kiln.mjs"));
  const refused = [await got(import("./tally.mjs"))];
  for (const round of [1, 2]) {
    vi.doMock("./kiln.mjs", () => ({ kiln: "mock " + round }));
    refused.push(await got(import("./tally.mjs")));
    vi.doUnmock("./kiln.mjs");
    refused.push(await got(import("./tally.mjs")));
  }
  console.log("SAID", refused.map((error, index) => error.name + (index ? (error === refused[index - 1] ? " kept" : " anew") : "")).join(), "firings", globalThis.firings);
});
