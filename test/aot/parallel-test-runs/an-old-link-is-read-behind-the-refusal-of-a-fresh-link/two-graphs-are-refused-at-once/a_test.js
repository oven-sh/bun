import { test, vi, afterAll } from "bun:test";
import { createRequire } from "node:module";
const log = [], require = createRequire(import.meta.url);
const tried = async load => { try { return "loaded " + (await load()).member(); } catch (error) { return error.name; } };
const sync = ask => { try { return "answered " + ask(); } catch (error) { return error.name; } };
afterAll(() => console.log("SAID", log.join()));
const mock = () => ({ square: 20 }), paint = () => ({ blue: 30 });
test("t", async () => {
  vi.doMock("./shapes.mjs", mock);
  vi.doMock("./colors.mjs", paint);
  const first = await import("./user.mjs"), second = await import("./painter.mjs");
  log.push("under " + first.member() + " " + second.member());
  vi.doUnmock("./shapes.mjs");
  vi.doUnmock("./colors.mjs");
  log.push("all " + (await Promise.all(["user", "painter", "user", "painter"].map(name => tried(() => import("./" + name + ".mjs"))))).join("|"));
  log.push("old " + first.member() + " " + second.member());
});
