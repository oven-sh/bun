import { test, vi, afterAll } from "bun:test";
const log = [];
const tried = async load => { try { return "loaded " + (await load()).member(); } catch (error) { return error.name; } };
afterAll(() => console.log("SAID", log.join()));
test("t", async () => {
  vi.doMock("./shapes.mjs", () => ({ round: 10, square: 20 }));
  const first = await import("./user.mjs"), second = await import("./named.mjs");
  const read = word => log.push(word + " " + first.member() + " " + first.keys() + " " + second.name());
  read("under");
  vi.doUnmock("./shapes.mjs");
  log.push("load 1 " + await tried(() => import("./user.mjs")));
  read("old 1");
  vi.doMock("./shapes.mjs", () => ({ round: 10, square: 20 }));
  log.push("again " + await tried(() => import("./user.mjs")));
  read("old behind");
});
