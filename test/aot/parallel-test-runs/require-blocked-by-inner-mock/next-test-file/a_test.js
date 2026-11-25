import { vi, mock, test } from "bun:test";
globalThis.bodies ??= 0;
let calls = 0, innerCalls = 0;
const short = e => "threw " + String(e.message).replace(/\/\S*\//g, "").slice(0, 48);
const now = read => { try { return String(read()); } catch (e) { return short(e); } };
const tried = async read => { try { return String(await read()); } catch (e) { return short(e); } };
const say = (...words) => console.log("|", ...words, "| calls", calls, "inner", innerCalls, "bodies", globalThis.bodies);
const untilBodyRuns = async () => { for (let turn = 0; turn < 1000 && !globalThis.bodies; turn++) await new Promise(setImmediate); };
test("first", async () => {
  vi.doMock("./inner.js", async () => { innerCalls++; await 0; return { inner: "inner mock" }; });
  vi.doMock("./dep.js", async () => { calls++; await 0; return { flag: "mock" }; });
  say("require 1:", now(() => import.meta.require("./dep.js").flag));
  say("import:", await tried(async () => (await import("./dep.js")).flag));
});
