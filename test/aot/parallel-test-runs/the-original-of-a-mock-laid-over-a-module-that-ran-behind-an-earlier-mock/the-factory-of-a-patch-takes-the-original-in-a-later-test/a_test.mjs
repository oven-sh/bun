import { mock, test, vi } from "bun:test";
test("mocked", async () => {
  mock.module("./tally.mjs", () => ({ word: "first" }));
  await import("./tally.mjs");
  const actual = await vi.importActual("./tally.mjs");
  actual.add();
  vi.doUnmock("./tally.mjs");
});
test("real", async () => {
  const real = await import("./tally.mjs");
  real.add();
  real.add();
});
test("mocked again", async () => {
  mock.module("./tally.mjs", async original => ({ ...(await original()), word: "second" }));
  const again = await import("./tally.mjs");
  console.log("SAID", again.word, again.sum());
});
