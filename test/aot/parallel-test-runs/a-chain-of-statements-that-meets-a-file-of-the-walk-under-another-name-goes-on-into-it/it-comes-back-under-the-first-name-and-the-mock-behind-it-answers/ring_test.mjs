import { test, mock } from "bun:test";
const tell = space => Object.keys(space).map(key => { try { return key + "=" + space[key]; } catch (error) { return key + "!" + error.name; } }).join();
const load = async path => { try { return tell(await import(path)); } catch (error) { return error.name + ": " + error.message; } };
test("ring", async () => {
  mock.module("./mocked.mjs", () => ({ z: 2, n: "mock" }));
  console.log("SAID r.mjs", await load("./r.mjs"));
  console.log("SAID q.mjs", await load("./q.mjs"));
  console.log("SAID t.mjs", await load("./t.mjs"));
});
