import { test, vi, afterAll } from "bun:test";
const log = [];
const tried = async load => { try { return "loaded " + (await load()).member(); } catch (error) { return error.name; } };
const safe = read => { try { return read(); } catch (error) { return error.name; } };
afterAll(() => console.log("SAID", log.join()));
test("t", async () => {
  log.push("fresh " + await tried(() => import("./fresh.mjs")));
  log.push("fresh " + await tried(() => import("./fresh.mjs")));
});
