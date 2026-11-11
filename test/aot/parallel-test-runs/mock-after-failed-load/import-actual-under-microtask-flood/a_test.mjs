import { test, vi } from "bun:test";
const say = (...values) => console.log("SAID", ...values.map(value => JSON.stringify(value)), globalThis.bodies ?? "");
test("a", async () => {
  say("potter", await import("./potter.mjs").then(module => module.pot, error => error.message));
  vi.doMock("./tint.mjs", () => ({ color: "red" }));
  let jobs = 0;
  let stop = false;
  const count = () => { if (!stop) { jobs++; Promise.resolve().then(count); } };
  count();
  const actual = await vi.importActual("./tint.mjs");
  stop = true;
  say("jobs", jobs > 0, actual.color);
});
