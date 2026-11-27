import { test, vi } from "bun:test";
test("the errors", async () => {
  const got = load => load.then(() => "loaded", error => error);
  const thrown = await got(import("./kiln.mjs"));
  const refused = [await got(import("./tally.mjs"))];
  vi.doMock("./kiln.mjs", () => ({ kiln: "mock" }));
  refused.push(await got(import("./tally.mjs")));
  console.log("SAID", thrown.message, refused[0].name, "refused kept", refused[0] === refused[1], "firings", globalThis.firings);
});
