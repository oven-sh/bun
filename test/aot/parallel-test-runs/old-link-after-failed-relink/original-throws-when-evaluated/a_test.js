import { test, vi, afterAll } from "bun:test";
import { createRequire } from "node:module";
const log = [], require = createRequire(import.meta.url);
const tried = async load => { try { return "loaded " + (await load()).member(); } catch (error) { return error.name + " " + String(error.message).slice(0, 22); } };
const sync = ask => { try { return "answered " + ask(); } catch (error) { return error.name + " " + String(error.message).slice(0, 22); } };
afterAll(() => console.log("SAID", log.join()));
const mock = () => ({ round: 10 });
test("t", async () => {
  vi.doMock("./breaks.mjs", mock);
  const first = await import("./user2.mjs");
  const old = () => log.push("old " + first.member());
  old();
  vi.doUnmock("./breaks.mjs");
  old();
  log.push("user2 " + await tried(() => import("./user2.mjs")));
  old();
  log.push("user2 " + await tried(() => import("./user2.mjs")));
  old();
});
