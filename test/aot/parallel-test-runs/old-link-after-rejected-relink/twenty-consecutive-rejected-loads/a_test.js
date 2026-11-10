import { test, vi, afterAll } from "bun:test";
import { createRequire } from "node:module";
const log = [], require = createRequire(import.meta.url);
const tried = async load => { try { return "loaded " + (await load()).member(); } catch (error) { return error.name; } };
const sync = ask => { try { return "answered " + ask(); } catch (error) { return error.name; } };
afterAll(() => console.log("SAID", log.join()));
const mock = () => ({ square: 20 }), paint = () => ({ blue: 30 });
test("t", async () => {
  vi.doMock("./shapes.mjs", mock);
  const first = await import("./user.mjs");
  log.push("under " + first.member());
  vi.doUnmock("./shapes.mjs");
  const behind = async turns => { for (let turn = 0; turn < turns; turn++) await null; const said = await tried(() => import("./user.mjs")); return said + "/" + first.member(); };
  log.push("all " + (await Promise.all(Array.from({ length: 20 }, (_, turns) => behind(turns)))).join("|"));
  log.push("old " + first.member());
});
