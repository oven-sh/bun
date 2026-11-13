import { test, vi } from "bun:test";
const attempt = run => { try { return run(); } catch (error) { return error.name; } };
test("a", async () => {
  let settle;
  vi.doMock("./leaf.mjs", () => new Promise(done => { settle = done; }));
  console.log("SAID", attempt(() => require("./leaf.mjs").tag), attempt(() => require("./user.mjs").read()));
  vi.doUnmock("./leaf.mjs");
});
