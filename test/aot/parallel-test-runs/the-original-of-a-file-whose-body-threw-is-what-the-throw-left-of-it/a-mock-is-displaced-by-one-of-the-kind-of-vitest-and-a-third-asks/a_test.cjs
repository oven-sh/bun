const { jest, mock, test, vi } = require("bun:test");
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
const tell = came => came === null || typeof came !== "object" && typeof came !== "function" ? String(came) : Object.keys(came).sort().map(name => { try { return name + "=" + (typeof came[name] === "function" ? "function" : String(came[name])); } catch (error) { return name + " threw " + error.name; } }).join();
const said = [];
const ask = async (tag, deed) => { try { said.push(tag + " came " + tell(await deed())); } catch (error) { said.push(tag + " threw " + error.name + " " + error.message); } };
test("one", async () => {
  mock.module("./lib.mjs", () => ({ a: "first" }));
  vi.doMock("./lib.mjs", () => ({ a: "of vitest" }));
  jest.doMock("./lib.mjs", async real => ({ a: "mocked" }));
  await spinEventLoop();
  await ask("import", () => import("./lib.mjs"));
  await ask("importActual", () => vi.importActual("./lib.mjs")); await ask("requireActual", () => jest.requireActual("./lib.mjs"));
  for (const line of said) console.log("SAID", line);
  console.log("SAID runs", (globalThis.runs ?? []).length);
});
