const { test, mock, vi } = require("bun:test");
const real = require("./lib.cjs");
test("t", async () => {
  const object = { a: "mock", n: -1 };
  mock.module("./lib.cjs", () => object);
  const reader = await import("./reader.mjs");
  const { lib } = await import("./space.mjs");
  const called = await import("./lib.cjs");
  const say = at => console.log("SAID", at, reader.a, reader.n, lib.a, lib.n, called === lib, Object.keys(called).sort().join(), real.n, globalThis.runs);
  say("under");
  object.n = -2;
  say("changed");
  vi.doUnmock("./lib.cjs");
  say("ended");
  const fresh = await import("./reader.mjs");
  console.log("SAID fresh", fresh === reader, fresh.a, fresh.n, require("./lib.cjs") === real);
});
