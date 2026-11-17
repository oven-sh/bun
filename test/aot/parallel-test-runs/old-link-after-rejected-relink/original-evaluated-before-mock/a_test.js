import { test, vi, afterAll } from "bun:test";
import { createRequire } from "node:module";
const log = [], require = createRequire(import.meta.url);
const tried = async load => { try { return "loaded " + (await load()).member(); } catch (error) { return error.name; } };
const sync = ask => { try { return "answered " + ask(); } catch (error) { return error.name; } };
afterAll(() => console.log("SAID", log.join()));
const mock = () => ({ square: 20 }), paint = () => ({ blue: 30 });
test("t", async () => {
  await import("./shapes.mjs");
  vi.doMock("./shapes.mjs", mock);
  const first = await import("./user.mjs");
  log.push("under " + first.member());
  vi.doUnmock("./shapes.mjs");
  log.push("removed");
  log.push("old " + first.member());
  log.push("refused " + await tried(() => import("./user.mjs")));
  log.push("old " + first.member());
});
