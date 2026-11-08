import { test, vi } from "bun:test";
test("the errors", async () => {
  const got = load => load.then(() => "loaded", error => error);
  const refused = [await got(import("./tally.mjs"))];
  const thrown = [await got(import("./pair.mjs"))];
  vi.doMock("./peg.mjs", () => ({ peg: "mock" }));
  refused.push(await got(import("./tally.mjs")));
  thrown.push(await got(import("./pair.mjs")));
  console.log("SAID", thrown[0].message, refused[0].name, "refused kept", refused[0] === refused[1], "thrown kept", thrown[0] === thrown[1], "firings", globalThis.firings);
});
