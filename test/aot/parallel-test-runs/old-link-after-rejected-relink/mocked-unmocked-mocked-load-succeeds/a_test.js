import { test, vi, afterAll } from "bun:test";
const log = [];
const tried = async load => { try { return "loaded " + (await load()).member(); } catch (error) { return error.name; } };
afterAll(() => console.log("SAID", log.join()));
test("t", async () => {
  const mock = () => ({ square: 20 });
  vi.doMock("./shapes.mjs", mock);
  const first = await import("./user.mjs");
  vi.doUnmock("./shapes.mjs");
  log.push("refused " + await tried(() => import("./user.mjs")));
  vi.doMock("./shapes.mjs", mock);
  vi.doUnmock("./shapes.mjs");
  vi.doMock("./shapes.mjs", mock);
  log.push("again " + await tried(() => import("./user.mjs")));
  log.push("old " + first.member());
});
