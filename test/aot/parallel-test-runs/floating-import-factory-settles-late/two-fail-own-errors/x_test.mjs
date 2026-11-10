import { test, vi } from "bun:test";
const pause = async () => { for (let job = 0; job < 30; job++) await 0; };
const said = promise => promise.then(all => "value " + all.x, error => "threw " + error.message);
test("x", async () => {
  const gates = {}; const answers = {};
  gates.all ??= Promise.withResolvers();
  vi.doMock("./m.mjs", async () => { await gates.all.promise; throw new Error("one"); });
  answers.one = said(import("./m.mjs"));
  await pause();
  gates.all ??= Promise.withResolvers();
  vi.doMock("./m.mjs", async () => { await gates.all.promise; throw new Error("two"); });
  answers.two = said(import("./m.mjs"));
  await pause();
  vi.doMock("./m.mjs", () => ({ x: "last" }));
  await import("./other.mjs");
  gates.all.resolve();
  console.log("SAID", "one:", await answers.one, "two:", await answers.two);
});
