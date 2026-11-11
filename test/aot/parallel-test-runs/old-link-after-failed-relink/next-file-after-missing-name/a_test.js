import { test, vi, afterAll } from "bun:test";
const log = [];
const tried = async load => { try { return "loaded " + (await load()).member(); } catch (error) { return error.name; } };
const safe = read => { try { return read(); } catch (error) { return error.name; } };
afterAll(() => console.log("SAID", log.join()));
test("t", async () => {
  vi.doMock("./shapes.mjs", () => ({ square: 20, flat: 21 }));
  const first = await import("./user.mjs");
  const old = () => log.push("old " + safe(() => first.member()));
  old();
  vi.doUnmock("./shapes.mjs");
  old();
  log.push("fails " + await tried(() => import("./asks.mjs")));
  old();
});
